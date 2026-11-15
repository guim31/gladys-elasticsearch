// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `cluster`.
//
// The use case: a glance tells whether the search cluster (behind Graylog,
// a log stack, a Nextcloud full-text search…) is fine. Tiles: the status in
// its color, the nodes, the unassigned shards, the documents and the size of
// the indices; then one row per node (disk and JVM heap, the fullest disk
// first) after the red indices — the problems first. A cluster that does not
// answer says so in words. The figures are sent as values, not bound to
// device features: the widget works before any device is added.
//
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): one heading,
// five tiles, one status list of eight rows at most, a Refresh button. The
// list and the button can be hidden in the settings.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, STATUS_TEXT, formatNumber, formatSize, pick, summarize } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  notConfigured: {
    en: 'Enter the address of the cluster in the configuration of the integration.',
    fr: "Saisissez l'adresse du cluster dans la configuration de l'intégration.",
    de: 'Gib die Adresse des Clusters in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección del clúster en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first answer of the cluster…',
    fr: 'En attente de la première réponse du cluster…',
    de: 'Warte auf die erste Antwort des Clusters …',
    es: 'Esperando la primera respuesta del clúster…',
  },
  status: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
  nodes: { en: 'Nodes', fr: 'Nœuds', de: 'Knoten', es: 'Nodos' },
  unassigned: {
    en: 'Unassigned shards',
    fr: 'Shards non assignés',
    de: 'Freie Shards',
    es: 'Shards sin asignar',
  },
  documents: { en: 'Documents', fr: 'Documents', de: 'Dokumente', es: 'Documentos' },
  size: { en: 'Size', fr: 'Taille', de: 'Größe', es: 'Tamaño' },
  redIndex: { en: 'Red index', fr: 'Index rouge', de: 'Roter Index', es: 'Índice rojo' },
  disk: { en: 'disk', fr: 'disque', de: 'Platte', es: 'disco' },
  heap: { en: 'heap', fr: 'tas', de: 'Heap', es: 'montón' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const STATUS_COLORS = {
  green: WIDGET_COLORS.SUCCESS,
  yellow: WIDGET_COLORS.WARNING,
  red: WIDGET_COLORS.DANGER,
};
/** The disk watermarks of Elasticsearch: 85 % low, 90 % high. */
const diskColor = (value) =>
  value >= 90 ? WIDGET_COLORS.DANGER : value >= 85 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;

/** A boolean setting, shown unless set to false. */
const shown = (settings, key) => settings?.[key] !== false && settings?.[key] !== 'false';

const message = (text, language, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text: t(text, language) }],
});

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** The rows of the status list: red indices, then the nodes, fullest disk first. */
function rows(snapshot, language) {
  const items = (snapshot.redIndices ?? []).map((index) => ({
    label: fit(index, 40),
    value: t(TEXT.redIndex, language),
    icon: 'alert-octagon',
    color: WIDGET_COLORS.DANGER,
  }));
  const nodes = [...(snapshot.nodes ?? [])].sort((a, b) => (b.disk ?? -1) - (a.disk ?? -1));
  for (const node of nodes) {
    const parts = [];
    if (node.disk !== null) {
      parts.push(`${t(TEXT.disk, language)} ${formatNumber(node.disk, language)} %`);
    }
    if (node.heap !== null) {
      parts.push(`${t(TEXT.heap, language)} ${formatNumber(node.heap, language)} %`);
    }
    items.push({
      label: fit(node.master ? `${node.name} ★` : node.name, 40),
      value: fit(parts.join(' · ') || '–', 40),
      icon: 'server',
      color: node.disk === null ? WIDGET_COLORS.NEUTRAL : diskColor(node.disk),
    });
  }
  if (items.length <= MAX_ROWS) {
    return items;
  }
  const kept = items.slice(0, MAX_ROWS - 1);
  kept.push({
    label: t(TEXT.more, language),
    value: `+${items.length - kept.length}`,
    icon: 'more-horizontal',
    color: WIDGET_COLORS.NEUTRAL,
  });
  return kept;
}

async function get(hub, { settings = {}, language = 'en' } = {}) {
  const view = hub.view();
  if (!view.configured) {
    return message(TEXT.notConfigured, language, 300);
  }
  const button = shown(settings, 'show_refresh') ? [refreshButton(language)] : [];
  const { snapshot } = view;
  if (!snapshot) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    return {
      ttl_seconds: 30,
      components: [
        { type: 'text', variant: 'heading', text: fit(view.name, 40) },
        { type: 'text', variant: 'body', text: summarize(view, language).slice(0, 300) },
        ...button,
      ],
    };
  }
  const components = [
    { type: 'text', variant: 'heading', text: fit(view.name, 40) },
    {
      type: 'value',
      value: t(STATUS_TEXT[snapshot.status] ?? STATUS_TEXT.red, language),
      label: t(TEXT.status, language),
      icon: 'activity',
      color: STATUS_COLORS[snapshot.status] ?? WIDGET_COLORS.DANGER,
    },
  ];
  if (snapshot.nodeCount !== null) {
    components.push({
      type: 'value',
      value: snapshot.nodeCount,
      label: t(TEXT.nodes, language),
      icon: 'server',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (snapshot.unassignedShards !== null) {
    components.push({
      type: 'value',
      value: snapshot.unassignedShards,
      label: t(TEXT.unassigned, language),
      icon: 'layers',
      color: snapshot.unassignedShards > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }
  if (snapshot.docCount !== null) {
    components.push({
      type: 'value',
      value: fit(formatNumber(snapshot.docCount, language), 12),
      label: t(TEXT.documents, language),
      icon: 'file-text',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (snapshot.storeBytes !== null) {
    components.push({
      type: 'value',
      value: formatSize(snapshot.storeBytes, language),
      label: t(TEXT.size, language),
      icon: 'database',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const list = shown(settings, 'show_nodes') ? rows(snapshot, language) : [];
  if (list.length > 0) {
    components.push({ type: 'status', items: list });
  }
  return { ttl_seconds: 60, components: [...components, ...button] };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.poll();
  const view = hub.view();
  return {
    message: view.snapshot
      ? STATUS_TEXT[view.snapshot.status]
      : (ERROR_TEXT[view.error?.kind] ?? TEXT.waiting),
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};

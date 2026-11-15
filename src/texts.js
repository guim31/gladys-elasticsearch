// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene event
// variables and scene action outputs. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './es/client.js';

export const LANGS = ['en', 'fr', 'de', 'es'];

/** The text of `language` in a multi-language object, English otherwise. */
export const pick = (text, language) => text?.[language] ?? text?.en ?? '';

/** A multi-language object from a function of the language. */
export const each = (fn) => Object.fromEntries(LANGS.map((language) => [language, fn(language)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of the cluster in the configuration.',
    fr: "Saisissez l'adresse du cluster dans la configuration.",
    de: 'Gib die Adresse des Clusters in der Konfiguration ein.',
    es: 'Introduzca la dirección del clúster en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.20 or https://es.lan:9200',
    fr: 'Adresse incomprise, ex. 192.168.1.20 ou https://es.lan:9200',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20 oder https://es.lan:9200',
    es: 'Dirección no válida, p. ej. 192.168.1.20 o https://es.lan:9200',
  },
  invalidFingerprint: {
    en: 'Certificate fingerprint not understood: 64 hexadecimal digits (SHA-256).',
    fr: 'Empreinte du certificat incomprise : 64 chiffres hexadécimaux (SHA-256).',
    de: 'Zertifikat-Fingerabdruck nicht verstanden: 64 Hexadezimalziffern (SHA-256).',
    es: 'Huella del certificado no válida: 64 dígitos hexadecimales (SHA-256).',
  },
};

// One short explanation per error kind (src/es/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the cluster does not answer at this address',
    fr: 'le cluster ne répond pas à cette adresse',
    de: 'der Cluster antwortet unter dieser Adresse nicht',
    es: 'el clúster no responde en esta dirección',
  },
  [ERROR_KINDS.TLS_UNTRUSTED]: {
    en: 'certificate not trusted: "Test the connection" shows its fingerprint',
    fr: 'certificat non reconnu : « Tester la connexion » affiche son empreinte',
    de: 'Zertifikat nicht vertrauenswürdig: „Verbindung testen“ zeigt seinen Fingerabdruck',
    es: 'certificado no reconocido: «Probar la conexión» muestra su huella',
  },
  [ERROR_KINDS.TLS_CHANGED]: {
    en: 'the certificate is no longer the confirmed one',
    fr: "le certificat n'est plus celui qui a été confirmé",
    de: 'das Zertifikat ist nicht mehr das bestätigte',
    es: 'el certificado ya no es el confirmado',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key or password missing or refused',
    fr: "clé d'API ou mot de passe manquant ou refusé",
    de: 'API-Schlüssel oder Passwort fehlt oder wurde abgelehnt',
    es: 'clave de API o contraseña ausente o rechazada',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'access refused: the user or key needs the "monitor" privilege',
    fr: "accès refusé : l'utilisateur ou la clé a besoin du privilège « monitor »",
    de: 'Zugriff verweigert: Benutzer oder Schlüssel braucht das Recht „monitor“',
    es: 'acceso denegado: el usuario o la clave necesita el privilegio «monitor»',
  },
  [ERROR_KINDS.NO_MASTER]: {
    en: 'the cluster has no elected master node',
    fr: "le cluster n'a pas de nœud maître élu",
    de: 'der Cluster hat keinen gewählten Master-Knoten',
    es: 'el clúster no tiene nodo maestro elegido',
  },
  [ERROR_KINDS.NOT_ELASTIC]: {
    en: 'this address does not answer like Elasticsearch or OpenSearch',
    fr: 'cette adresse ne répond pas comme Elasticsearch ou OpenSearch',
    de: 'diese Adresse antwortet nicht wie Elasticsearch oder OpenSearch',
    es: 'esta dirección no responde como Elasticsearch u OpenSearch',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'the cluster answers with an error',
    fr: 'le cluster répond par une erreur',
    de: 'der Cluster antwortet mit einem Fehler',
    es: 'el clúster responde con un error',
  },
};

export const STATUS_TEXT = {
  green: { en: 'Green', fr: 'Vert', de: 'Grün', es: 'Verde' },
  yellow: { en: 'Yellow', fr: 'Jaune', de: 'Gelb', es: 'Amarillo' },
  red: { en: 'Red', fr: 'Rouge', de: 'Rot', es: 'Rojo' },
};

/** Thousands separators of the language. */
export const formatNumber = (value, language, digits = 0) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

/** A size in bytes, in GB (or MB under 1 GB). */
export function formatSize(bytes, language) {
  const units = { en: ['MB', 'GB'], fr: ['Mo', 'Go'], de: ['MB', 'GB'], es: ['MB', 'GB'] };
  const [mb, gb] = units[language] ?? units.en;
  return bytes >= 1e9
    ? `${formatNumber(bytes / 1e9, language, 1)} ${gb}`
    : `${formatNumber(bytes / 1e6, language, 1)} ${mb}`;
}

const SUMMARY = {
  en: {
    cluster: (name, status) => `Cluster ${name}: ${status}`,
    nodes: (n) => `${n} node${n === 1 ? '' : 's'}`,
    unassigned: (n) => `${n} unassigned shard${n === 1 ? '' : 's'}`,
    red: (list) => `red indices: ${list}`,
    disk: (node, value) => `disk of ${node} ${value} %`,
    unreachable: (name, reason) => `Cluster ${name}: ${reason}`,
  },
  fr: {
    cluster: (name, status) => `Cluster ${name} : ${status.toLowerCase()}`,
    nodes: (n) => `${n} nœud${n > 1 ? 's' : ''}`,
    unassigned: (n) => `${n} shard${n > 1 ? 's' : ''} non assigné${n > 1 ? 's' : ''}`,
    red: (list) => `index rouges : ${list}`,
    disk: (node, value) => `disque de ${node} ${value} %`,
    unreachable: (name, reason) => `Cluster ${name} : ${reason}`,
  },
  de: {
    cluster: (name, status) => `Cluster ${name}: ${status.toLowerCase()}`,
    nodes: (n) => `${n} Knoten`,
    unassigned: (n) => `${n} nicht zugewiesene${n === 1 ? 'r' : ''} Shard${n === 1 ? '' : 's'}`,
    red: (list) => `rote Indizes: ${list}`,
    disk: (node, value) => `Datenträger von ${node} ${value} %`,
    unreachable: (name, reason) => `Cluster ${name}: ${reason}`,
  },
  es: {
    cluster: (name, status) => `Clúster ${name}: ${status.toLowerCase()}`,
    nodes: (n) => `${n} nodo${n === 1 ? '' : 's'}`,
    unassigned: (n) => `${n} shard${n === 1 ? '' : 's'} sin asignar`,
    red: (list) => `índices rojos: ${list}`,
    disk: (node, value) => `disco de ${node} ${value} %`,
    unreachable: (name, reason) => `Clúster ${name}: ${reason}`,
  },
};

// The disks shown in a summary: the fullest first, at most this many.
export const MAX_SUMMARY_DISKS = 3;
export const MAX_LISTED_INDICES = 10;

/** A comma separated list, the rest counted. */
export function shortList(names, max) {
  const listed = names.slice(0, max);
  const more = names.length > listed.length ? `, +${names.length - listed.length}` : '';
  return `${listed.join(', ')}${more}`;
}

/**
 * The one-line state of the cluster, for a scene message.
 * @param {{ name: string, snapshot: object|null, error: object|null }} view
 * @param {string} language
 */
export function summarize(view, language) {
  const text = SUMMARY[language] ?? SUMMARY.en;
  const { snapshot } = view;
  if (!snapshot) {
    const reason = pick(ERROR_TEXT[view.error?.kind ?? ERROR_KINDS.UNREACHABLE], language);
    return text.unreachable(view.name, reason);
  }
  const parts = [
    text.cluster(view.name, pick(STATUS_TEXT[snapshot.status] ?? STATUS_TEXT.red, language)),
  ];
  if (snapshot.nodeCount !== null) {
    parts.push(text.nodes(snapshot.nodeCount));
  }
  if (snapshot.unassignedShards) {
    parts.push(text.unassigned(snapshot.unassignedShards));
  }
  if (snapshot.redIndices?.length) {
    parts.push(text.red(shortList(snapshot.redIndices, MAX_LISTED_INDICES)));
  }
  const disks = (snapshot.nodes ?? [])
    .filter((node) => node.disk !== null)
    .sort((a, b) => b.disk - a.disk)
    .slice(0, MAX_SUMMARY_DISKS);
  for (const node of disks) {
    parts.push(text.disk(node.name, formatNumber(node.disk, language, 1)));
  }
  return parts.join(', ');
}

// The "Test the connection" report, line by line.
export const REPORT_TEXT = {
  en: {
    found: (product, name, status, nodes) =>
      `${product}, cluster ${name}: ${status.toLowerCase()}, ${nodes}.`,
    fingerprint: (value) => `Certificate (SHA-256): ${value}`,
    confirm:
      'If it is the certificate of your cluster, copy it into "Certificate fingerprint" and save.',
    changed: 'The certificate changed: check it, then copy the new fingerprint and save.',
    partial: 'Node details refused: give the "monitor" cluster privilege for them.',
    failed: (reason) => `Connection failed: ${reason}.`,
  },
  fr: {
    found: (product, name, status, nodes) =>
      `${product}, cluster ${name} : ${status.toLowerCase()}, ${nodes}.`,
    fingerprint: (value) => `Certificat (SHA-256) : ${value}`,
    confirm:
      "Si c'est le certificat de votre cluster, copiez-le dans « Empreinte du certificat » et enregistrez.",
    changed:
      'Le certificat a changé : vérifiez-le, puis copiez la nouvelle empreinte et enregistrez.',
    partial: 'Détail des nœuds refusé : donnez-lui le privilège de cluster « monitor ».',
    failed: (reason) => `Connexion impossible : ${reason}.`,
  },
  de: {
    found: (product, name, status, nodes) =>
      `${product}, Cluster ${name}: ${status.toLowerCase()}, ${nodes}.`,
    fingerprint: (value) => `Zertifikat (SHA-256): ${value}`,
    confirm:
      'Wenn es das Zertifikat deines Clusters ist, kopiere es in „Zertifikat-Fingerabdruck“ und speichere.',
    changed:
      'Das Zertifikat hat sich geändert: Prüfe es, kopiere dann den neuen Fingerabdruck und speichere.',
    partial: 'Knotendetails verweigert: Vergib dafür das Cluster-Recht „monitor“.',
    failed: (reason) => `Verbindung fehlgeschlagen: ${reason}.`,
  },
  es: {
    found: (product, name, status, nodes) =>
      `${product}, clúster ${name}: ${status.toLowerCase()}, ${nodes}.`,
    fingerprint: (value) => `Certificado (SHA-256): ${value}`,
    confirm: 'Si es el certificado de su clúster, cópielo en «Huella del certificado» y guarde.',
    changed: 'El certificado ha cambiado: compruébelo, copie la nueva huella y guarde.',
    partial: 'Detalle de los nodos denegado: concédale el privilegio de clúster «monitor».',
    failed: (reason) => `Conexión imposible: ${reason}.`,
  },
};

/**
 * The report of the "Test the connection" action, in the four languages.
 * @param {{ snapshot: object|null, error: object|null, fingerprint: string|null }} result
 */
export function testReport({ snapshot, error, fingerprint }) {
  return each((language) => {
    const text = REPORT_TEXT[language];
    const lines = [];
    if (snapshot) {
      const status = pick(STATUS_TEXT[snapshot.status] ?? STATUS_TEXT.red, language);
      const nodes = SUMMARY[language].nodes(snapshot.nodeCount ?? 0);
      lines.push(
        text.found(`${snapshot.product} ${snapshot.version}`, snapshot.clusterName, status, nodes),
      );
      if (snapshot.nodes === null) {
        lines.push(text.partial);
      }
    } else {
      lines.push(text.failed(pick(ERROR_TEXT[error?.kind ?? ERROR_KINDS.UNREACHABLE], language)));
    }
    if (fingerprint) {
      lines.push(text.fingerprint(fingerprint));
    }
    if (error?.kind === ERROR_KINDS.TLS_UNTRUSTED) {
      lines.push(text.confirm);
    } else if (error?.kind === ERROR_KINDS.TLS_CHANGED) {
      lines.push(text.changed);
    }
    return lines.join('\n');
  });
}

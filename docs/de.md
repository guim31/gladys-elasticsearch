# Elasticsearch / OpenSearch

Der Zustand deines Elasticsearch- oder OpenSearch-Clusters in Gladys:
Status, Knoten, Shards, Platten, Szenen-Auslöser und ein Widget. Nur lesend:
Die Integration schreibt nie in den Cluster.

Getestet mit echten Clustern Elasticsearch 8.19 und OpenSearch 2.19 (in
Docker, mit und ohne Sicherheit). Rückmeldungen sind willkommen auf
[GitHub](https://github.com/guim31/gladys-elasticsearch/issues).

## Was du bekommst

Im Tab **Entdecken** ein Gerät für den Cluster und eines pro Knoten.

Das Cluster-Gerät:

- **Status (0 grün, 1 gelb, 2 rot)**: der Zustand des Clusters. Gelb: ein
  Replikat ist nicht zugewiesen (normal auf einem einzelnen Knoten mit
  Replikaten). Rot: ein primärer Shard fehlt, Daten sind nicht durchsuchbar.
- **Knoten**, **Datenknoten**, **Aktive Shards**, **Nicht zugewiesene Shards**.
- **Indizes**, **Dokumente**, **Größe der Indizes** (GB).
- **Version**: das Produkt und seine Version, z. B. `OpenSearch 2.19.3`.

Jedes Knoten-Gerät:

- **Belegter Datenträger**, **Belegter JVM-Heap**, **Prozessor** (%),
  **Last (1 min)**.
- **Shards**: die Shards, die er hält.
- **Im Cluster**: 1, solange der Knoten zum Cluster gehört, 0, sobald er ihn
  verlassen hat (sein Abzeichen zeigt dann „nicht erreichbar“).

## Konfiguration

1. Ist die Sicherheit aktiv (Standard bei Elasticsearch 8), lege für Gladys
   einen API-Schlüssel nur für die Überwachung an, zum Beispiel in Kibana →
   Dev Tools:

   ```
   POST /_security/api_key
   {"name": "gladys", "role_descriptors": {"gladys": {
     "cluster": ["monitor"],
     "indices": [{"names": ["*"], "privileges": ["monitor"]}]}}}
   ```

   Kopiere den Wert `encoded` in **API-Schlüssel (Elasticsearch)**. Bei
   OpenSearch oder ohne API-Schlüssel lege einen Benutzer mit der Berechtigung
   `cluster_monitor` an (und `indices_monitor`, um rote Indizes zu nennen) und
   fülle **Benutzer** und **Passwort** aus. Nie das Konto `elastic` oder
   `admin`.

2. **Adresse**: ein beliebiger Knoten, z. B. `192.168.1.20` (Port 9200, erst
   HTTPS, dann HTTP) oder `https://es.lan:9200`.
3. HTTPS mit selbstsigniertem Zertifikat (Standard bei Elasticsearch 8 und
   OpenSearch): Klicke auf **Verbindung testen**. Es zeigt den
   SHA-256-Fingerabdruck des Zertifikats. Prüfe, dass es der deines Clusters
   ist: Auf dem Server zeigt ihn
   `openssl s_client -connect localhost:9200 </dev/null | openssl x509 -noout -fingerprint -sha256`
   an. Kopiere ihn dann in **Zertifikat-Fingerabdruck** und speichere. Dann
   wird nur dieses Zertifikat akzeptiert. **Jedes Zertifikat akzeptieren**
   überspringt jede Prüfung: besser nicht.
4. Füge den Cluster und die gewünschten Knoten im Tab **Entdecken** hinzu.

Das **Aktualisierungsintervall** (standardmäßig 1 Minute) legt fest, wie oft
der Cluster gelesen wird: jedes Mal fünf leichte Überwachungsanfragen (sechs,
wenn er rot ist). Die **Sprache der Namen** legt die Namen der Funktionen
fest, beim Hinzufügen eines Geräts fixiert, und die Texte für Szenen.

## Aktionen

- **Verbindung testen**: liest den Cluster jetzt und sagt, was gefunden wurde
  (Produkt, Status, Knoten), mit dem Fingerabdruck eines HTTPS-Zertifikats.

## Szenen

Auslöser, die ohne hinzugefügtes Gerät funktionieren:

- **Cluster-Status ändert sich**: der Status wird grün, gelb oder rot. Wähle
  den neuen Status oder lass das Feld leer für jede Änderung. Variablen: der
  Cluster, der neue und der vorherige Status, die nicht zugewiesenen Shards,
  die roten Indizes.
- **Knoten-Platte fast voll**: die Platte eines Knotens erreicht 80, 85, 90
  oder 95 %. 85 % ist die untere Wassermarke von Elasticsearch (keine neuen
  Shards auf dem Knoten), 90 % die obere (Shards ziehen weg), 95 % die
  Flutmarke (seine Indizes werden schreibgeschützt). Erneut gemeldet, wenn
  die Platte 2 Punkte darunter war.
- **Cluster nicht erreichbar**: der Cluster antwortet nicht mehr, bei zwei
  Abfragen hintereinander (eine fehlgeschlagene Abfrage wird nach 20 Sekunden
  wiederholt). Variable: der Grund.

Aktion:

- **Zustand des Clusters**: liest den Cluster für die nächsten Aktionen:
  Status, Knoten, nicht zugewiesene Shards, Dokumente, vollste Platte und
  eine fertige Zusammenfassung für eine Nachricht („Cluster logs: gelb,
  3 Knoten, 2 nicht zugewiesene Shards, Datenträger von es-1 87 % …“).

## Dashboard

Das Widget **Suchcluster** zeigt den Status in seiner Farbe, die Knoten, die
nicht zugewiesenen Shards, die Dokumente und die Größe der Indizes, dann die
roten Indizes und eine Zeile pro Knoten (Platte und Heap, die vollste Platte
zuerst, ★ für den gewählten Master). Seine Schaltfläche **Aktualisieren**
liest den Cluster neu. Liste und Schaltfläche lassen sich in den
Widget-Einstellungen ausblenden.

## Grenzen

- Ein Cluster pro Installation der Integration.
- Getestet mit Elasticsearch 8 und OpenSearch 2; Elasticsearch 7 und OpenSearch 1 bieten dieselben APIs (ungetestet). Elastic Cloud geht auch
  (API-Schlüssel, `https://…:443`), die Integration ist aber für einen Cluster
  in deinem Netz gedacht.
- Der Zustand der Indizes wird nicht Index für Index verfolgt: Nur die Namen
  der roten werden genannt.

## Fehlerbehebung

- „Zertifikat nicht vertrauenswürdig“: siehe Schritt 3 der Konfiguration.
- „Zugriff verweigert“: Schlüssel oder Benutzer fehlt das Cluster-Recht
  `monitor`. Nur mit dem Cluster-Zustand funktioniert das Cluster-Gerät
  trotzdem, ohne Knoten, Dokumente und Größe.
- Die Details jeder Abfrage stehen in den Protokollen der Integration mit
  `LOG_LEVEL=debug`.

Elasticsearch ist eine Marke von Elasticsearch B.V., OpenSearch von LF
Projects, LLC. Diese Integration ist mit keiner von beiden verbunden.

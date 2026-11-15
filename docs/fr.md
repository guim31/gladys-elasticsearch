# Elasticsearch / OpenSearch

La santé de votre cluster Elasticsearch ou OpenSearch dans Gladys : état,
nœuds, shards, disques, déclencheurs de scène et un widget. Lecture seule :
l'intégration n'écrit jamais dans le cluster.

Testée contre de vrais clusters Elasticsearch 8.19 et OpenSearch 2.19 (sous
Docker, avec et sans sécurité). Vos retours sont les bienvenus sur
[GitHub](https://github.com/guim31/gladys-elasticsearch/issues).

## Ce que vous obtenez

Dans l'onglet **Découverte**, un appareil pour le cluster et un par nœud.

L'appareil du cluster :

- **État (0 vert, 1 jaune, 2 rouge)** : l'état de santé du cluster. Jaune :
  une réplique n'est pas allouée (normal sur un nœud unique avec répliques).
  Rouge : un shard primaire manque, des données ne sont plus consultables.
- **Nœuds**, **Nœuds de données**, **Shards actifs**, **Shards non assignés**.
- **Index**, **Documents**, **Taille des index** (Go).
- **Version** : le produit et sa version, ex. `OpenSearch 2.19.3`.

Chaque appareil de nœud :

- **Disque utilisé**, **Tas JVM utilisé**, **Processeur** (%), **Charge (1 min)**.
- **Shards** : les shards qu'il porte.
- **Dans le cluster** : 1 tant que le nœud fait partie du cluster, 0 une fois
  qu'il l'a quitté (son badge indique alors injoignable).

## Configuration

1. Si la sécurité est activée (le cas par défaut d'Elasticsearch 8), créez
   pour Gladys une clé d'API limitée à la supervision, par exemple dans
   Kibana → Dev Tools :

   ```
   POST /_security/api_key
   {"name": "gladys", "role_descriptors": {"gladys": {
     "cluster": ["monitor"],
     "indices": [{"names": ["*"], "privileges": ["monitor"]}]}}}
   ```

   Copiez la valeur `encoded` dans **Clé d'API (Elasticsearch)**. Avec
   OpenSearch, ou sans clé d'API, créez un utilisateur avec la permission
   `cluster_monitor` (et `indices_monitor` pour nommer les index rouges), et
   remplissez **Utilisateur** et **Mot de passe**. Jamais le compte `elastic`
   ou `admin`.

2. **Adresse** : n'importe quel nœud, ex. `192.168.1.20` (port 9200, HTTPS
   essayé d'abord, puis HTTP) ou `https://es.lan:9200`.
3. HTTPS avec un certificat auto-signé (le cas par défaut d'Elasticsearch 8
   et d'OpenSearch) : cliquez sur **Tester la connexion**. Le bouton affiche
   l'empreinte SHA-256 du certificat. Vérifiez que c'est celle de votre
   cluster : sur le serveur,
   `openssl s_client -connect localhost:9200 </dev/null | openssl x509 -noout -fingerprint -sha256`
   l'affiche. Copiez-la ensuite dans **Empreinte du certificat** et
   enregistrez. Seul ce certificat est alors accepté. **Accepter tout
   certificat** saute toute vérification : à éviter.
4. Ajoutez le cluster et les nœuds voulus depuis l'onglet **Découverte**.

L'**Intervalle de rafraîchissement** (1 minute par défaut) règle la
fréquence de lecture du cluster : cinq requêtes légères de supervision à
chaque fois (six quand il est rouge). La **Langue des noms** règle les noms
des fonctionnalités, figés à l'ajout d'un appareil, et les textes envoyés aux
scènes.

## Actions

- **Tester la connexion** : lit le cluster maintenant et dit ce qu'il a
  trouvé (produit, état, nœuds), avec l'empreinte d'un certificat HTTPS.

## Scènes

Déclencheurs, qui fonctionnent sans ajouter d'appareil :

- **L'état du cluster change** : l'état passe au vert, au jaune ou au rouge.
  Choisissez le nouvel état, ou laissez vide pour tout changement. Variables :
  le cluster, le nouvel état et le précédent, les shards non assignés, les
  index rouges.
- **Disque de nœud presque plein** : le disque d'un nœud atteint 80, 85, 90
  ou 95 %. 85 % est le seuil bas d'Elasticsearch (plus de nouveau shard sur
  le nœud), 90 % le seuil haut (les shards partent ailleurs), 95 % le seuil
  d'inondation (ses index passent en lecture seule). Annoncé de nouveau une
  fois le disque redescendu de 2 points.
- **Cluster injoignable** : le cluster ne répond plus, sur deux lectures de
  suite (une lecture en échec est retentée après 20 secondes). Variable : la
  raison.

Action :

- **Santé du cluster** : lit le cluster pour les actions suivantes : état,
  nœuds, shards non assignés, documents, disque le plus plein, et un résumé
  prêt à envoyer dans un message (« Cluster logs : jaune, 3 nœuds, 2 shards
  non assignés, disque de es-1 87 %… »).

## Tableau de bord

Le widget **Cluster de recherche** affiche l'état dans sa couleur, les
nœuds, les shards non assignés, les documents et la taille des index, puis
les index rouges et une ligne par nœud (disque et tas, le disque le plus
plein d'abord, ★ pour le maître élu). Son bouton **Actualiser** relit le
cluster. La liste comme le bouton se masquent dans les réglages du widget.

## Limites

- Un seul cluster par installation de l'intégration.
- Testée avec Elasticsearch 8 et OpenSearch 2 ; Elasticsearch 7 et OpenSearch 1 répondent aux mêmes API (non testé). Elastic Cloud
  fonctionne aussi (clé d'API, `https://…:443`), mais l'intégration est pensée
  pour un cluster sur votre réseau.
- La santé des index n'est pas suivie index par index : seuls les noms des
  index rouges sont donnés.

## Dépannage

- « Certificat non reconnu » : voir l'étape 3 de la configuration.
- « Accès refusé » : la clé ou l'utilisateur n'a pas le privilège de cluster
  `monitor`. Avec la seule santé du cluster, l'appareil du cluster fonctionne
  quand même, sans nœuds, documents ni taille.
- Le détail de chaque lecture est dans les logs de l'intégration avec
  `LOG_LEVEL=debug`.

Elasticsearch est une marque d'Elasticsearch B.V., OpenSearch de LF
Projects, LLC. Cette intégration n'est affiliée ni à l'une ni à l'autre.

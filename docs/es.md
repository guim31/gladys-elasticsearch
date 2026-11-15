# Elasticsearch / OpenSearch

La salud de su clúster Elasticsearch u OpenSearch en Gladys: estado, nodos,
shards, discos, disparadores de escena y un widget. Solo lectura: la
integración nunca escribe en el clúster.

Probada con clústeres reales Elasticsearch 8.19 y OpenSearch 2.19 (en
Docker, con y sin seguridad). Sus comentarios son bienvenidos en
[GitHub](https://github.com/guim31/gladys-elasticsearch/issues).

## Lo que obtiene

En la pestaña **Descubrir**, un dispositivo para el clúster y uno por nodo.

El dispositivo del clúster:

- **Estado (0 verde, 1 amarillo, 2 rojo)**: el estado de salud del clúster.
  Amarillo: una réplica no está asignada (normal en un solo nodo con
  réplicas). Rojo: falta un shard primario, hay datos que no se pueden buscar.
- **Nodos**, **Nodos de datos**, **Shards activos**, **Shards sin asignar**.
- **Índices**, **Documentos**, **Tamaño de los índices** (GB).
- **Versión**: el producto y su versión, p. ej. `OpenSearch 2.19.3`.

Cada dispositivo de nodo:

- **Disco usado**, **Montón JVM usado**, **Procesador** (%), **Carga (1 min)**.
- **Shards**: los shards que contiene.
- **En el clúster**: 1 mientras el nodo forma parte del clúster, 0 cuando lo
  ha dejado (su distintivo indica entonces inaccesible).

## Configuración

1. Con la seguridad activada (lo predeterminado en Elasticsearch 8), cree
   para Gladys una clave de API limitada a la supervisión, por ejemplo en
   Kibana → Dev Tools:

   ```
   POST /_security/api_key
   {"name": "gladys", "role_descriptors": {"gladys": {
     "cluster": ["monitor"],
     "indices": [{"names": ["*"], "privileges": ["monitor"]}]}}}
   ```

   Copie el valor `encoded` en **Clave de API (Elasticsearch)**. Con
   OpenSearch, o sin claves de API, cree un usuario con el permiso
   `cluster_monitor` (e `indices_monitor` para nombrar los índices rojos) y
   rellene **Usuario** y **Contraseña**. Nunca la cuenta `elastic` o `admin`.

2. **Dirección**: cualquier nodo, p. ej. `192.168.1.20` (puerto 9200, primero
   HTTPS y luego HTTP) o `https://es.lan:9200`.
3. HTTPS con un certificado autofirmado (lo predeterminado en
   Elasticsearch 8 y OpenSearch): pulse **Probar la conexión**. Muestra la
   huella SHA-256 del certificado. Compruebe que es la de su clúster: en el
   servidor,
   `openssl s_client -connect localhost:9200 </dev/null | openssl x509 -noout -fingerprint -sha256`
   la muestra. Después cópiela en **Huella del certificado** y guarde.
   Entonces solo se acepta este certificado. **Aceptar cualquier
   certificado** omite toda comprobación: evítelo.
4. Añada el clúster y los nodos que desee desde la pestaña **Descubrir**.

El **Intervalo de actualización** (1 minuto por defecto) fija con qué
frecuencia se lee el clúster: cinco peticiones ligeras de supervisión cada
vez (seis cuando está en rojo). El **Idioma de los nombres** fija los nombres
de las funciones, fijados al añadir un dispositivo, y los textos enviados a
las escenas.

## Acciones

- **Probar la conexión**: lee ahora el clúster e indica lo que ha encontrado
  (producto, estado, nodos), con la huella de un certificado HTTPS.

## Escenas

Disparadores, que funcionan sin añadir ningún dispositivo:

- **Cambia el estado del clúster**: el estado pasa a verde, amarillo o rojo.
  Elija el nuevo estado, o déjelo vacío para cualquier cambio. Variables: el
  clúster, el estado nuevo y el anterior, los shards sin asignar, los índices
  rojos.
- **Disco de nodo casi lleno**: el disco de un nodo alcanza el 80, 85, 90 o
  95 %. El 85 % es la marca baja de Elasticsearch (ningún shard nuevo en el
  nodo), el 90 % la alta (los shards se van a otro nodo), el 95 % la de
  inundación (sus índices pasan a solo lectura). Se avisa de nuevo cuando el
  disco baja 2 puntos.
- **Clúster inaccesible**: el clúster ya no responde, en dos lecturas
  seguidas (una lectura fallida se reintenta a los 20 segundos). Variable: el
  motivo.

Acción:

- **Salud del clúster**: lee el clúster para las acciones siguientes: estado,
  nodos, shards sin asignar, documentos, disco más lleno y un resumen listo
  para enviar en un mensaje («Clúster logs: amarillo, 3 nodos, 2 shards sin
  asignar, disco de es-1 87 %…»).

## Panel

El widget **Clúster de búsqueda** muestra el estado en su color, los nodos,
los shards sin asignar, los documentos y el tamaño de los índices, después
los índices rojos y una fila por nodo (disco y montón, el disco más lleno
primero, ★ para el maestro elegido). Su botón **Actualizar** vuelve a leer
el clúster. La lista y el botón se pueden ocultar en los ajustes del widget.

## Límites

- Un solo clúster por instalación de la integración.
- Probada con Elasticsearch 8 y OpenSearch 2; Elasticsearch 7 y OpenSearch 1 ofrecen las mismas API (sin probar). Elastic Cloud
  también funciona (clave de API, `https://…:443`), pero la integración está
  pensada para un clúster en su red.
- La salud de los índices no se sigue índice por índice: solo se dan los
  nombres de los rojos.

## Solución de problemas

- «Certificado no reconocido»: vea el paso 3 de la configuración.
- «Acceso denegado»: a la clave o al usuario le falta el privilegio de
  clúster `monitor`. Solo con la salud del clúster, el dispositivo del clúster
  sigue funcionando, sin nodos, documentos ni tamaño.
- El detalle de cada lectura está en los registros de la integración con
  `LOG_LEVEL=debug`.

Elasticsearch es una marca de Elasticsearch B.V., OpenSearch de LF Projects,
LLC. Esta integración no está afiliada a ninguna de las dos.

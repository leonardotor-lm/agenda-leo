# Gestor de Tareas Personal - Arquitectura Desacoplada e Integración de Servicios

Este proyecto consiste en una aplicación web autoportante diseñada para la gestión y organización avanzada de tareas cotidianas y profesionales. Su diseño arquitectónico prioriza la velocidad de ejecución, la estabilidad del entorno y la simplicidad estructural. El sistema ejecuta la totalidad de su lógica de interfaz en el cliente mediante tecnologías web estándar y delega la persistencia de datos y la automatización de servicios en la nube de Google, utilizando una pasarela intermedia construida en Google Apps Script.

La presente documentación funciona como un mapa técnico exhaustivo para el desarrollo, el mantenimiento futuro y la inducción de asistentes de Inteligencia Artificial que colaboren activamente en la evolución y escalabilidad del software.

---

## Arquitectura y Tecnologías

El sistema adopta una arquitectura desacoplada de tipo cliente-servidor, caracterizada por una alta fidelidad funcional y un bajo acoplamiento entre sus componentes:

### Frontend (Cliente)
* **HTML5 y Tailwind CSS:** Utilizados de manera exclusiva para la estructuración semántica y el diseño responsivo de la interfaz gráfica de usuario. El estilo visual aprovecha las variables y clases utilitarias de Tailwind para consolidar una estética limpia, minimalista y unificada.
* **Vanilla JavaScript (ES6+):** Constituye el motor principal de ejecución en el navegador. La aplicación se adhiere firmemente a una filosofía *frameworkless* (sin dependencias externas), lo que asegura una carga instantánea, un rendimiento óptimo en el renderizado del DOM y la eliminación absoluta de conflictos de compatibilidad por librerías desactualizadas.

### Backend y Servicios en la Nube (Persistencia y Automatización)
* **Google Sheets:** Funciona como la base de datos principal del sistema. Utiliza un modelo no relacional simplificado de un solo registro para almacenar el estado global de la agenda.
* **Google Drive:** Actúa como el repositorio de almacenamiento para los archivos adjuntos vinculados a las tareas, organizándolos dentro de una carpeta dedicada y gestionando los permisos de visibilidad de manera automatizada.
* **Google Calendar:** Opera como un receptor pasivo y unidireccional de eventos temporales. El sistema interactúa con este servicio a través de la API nativa de Google para registrar alertas en la agenda del usuario sin permitir flujos inversos de modificación.
* **Google Apps Script (GAS):** Entorno de ejecución basado en la nube que expone un servicio web mediante los métodos estándar `doGet` y `doPost`. Funciona como el nexo lógico indispensable que recibe, procesa, valida y sirve las peticiones HTTP originadas por el cliente.

---

## Estructura de Archivos del Proyecto

La distribución de componentes en el repositorio se organiza de forma modular para garantizar la mantenibilidad del código:

* **`index.html`:** Estructura fundamental de la aplicación web y puntos de montaje para la interfaz de usuario. Alberga los formularios de captura, los contenedores de las distintas vistas y los modales de configuración técnica.
* **`app.js`:** Núcleo de la lógica del cliente. Administra el estado global de la aplicación, las mutaciones del árbol de tareas, los algoritmos de ordenamiento, el filtrado en tiempo real, el renderizado dinámico en el DOM y el despacho asincrónico de payloads hacia el servidor.
* **`Codigo.gs`:** Script principal del backend en Google Apps Script. Controla el enrutamiento de las peticiones HTTP (`doGet` y `doPost`), la persistencia en la hoja de cálculo y la recepción de archivos multimedia destinados a Google Drive.
* **`calendar.gs`:** Módulo exclusivo y aislado dentro del backend que encapsula la lógica de comunicación con la API de Google Calendar. Contiene las funciones de instanciación de eventos y las rutinas de diagnóstico técnico.
* **`appsscript.json`:** Archivo de manifiesto de configuración del entorno de Apps Script. Declara formalmente las directivas del motor de ejecución (V8), la zona horaria del sistema y los alcances explícitos de seguridad OAuth (`oauthScopes`) requeridos para operar sobre Sheets, Drive y Calendar.
* **Guías Auxiliares (`github_setup_guide.md`, `gemini_api_guide.md`, `apps_script_guide.md`):** Documentos técnicos que detallan los protocolos de despliegue, aprovisionamiento de credenciales de seguridad y sincronización para el usuario final.

---

## Flujo de Sincronización con Google Sheets

La persistencia remota evita deliberadamente la complejidad de gestionar múltiples filas y columnas para cada tarea individual. En su lugar, implementa una estrategia de almacenamiento centralizada mediante un único bloque de texto serializado:

```
[ Cliente (app.js) ]                             [ Google Apps Script (doPost) ]          [ Google Sheets ]
|                                                       |                                |
| -- POST (JSON completo en texto plano) -------------> | -- Escribe JSON en Celda A1 -> |
|                                                       |                                |
| -- GET (Petición de lectura) -----------------------> | <--- Lee Celda A1 -------------|
| <------ Devuelve array JSON parsed ------------------ |                                |
```

### Operaciones de Lectura (GET)
1. Al inicializar la aplicación en el navegador, si se detecta una URL de base de datos válida en el almacenamiento local, se invoca de forma automática la función `loadDataFromCloud()`.
2. El cliente realiza una petición HTTP `GET` dirigida al endpoint público de la aplicación web de Apps Script.
3. El método `doGet()` del script lee el valor textual crudo contenido en la celda A1 de la hoja interna denominada 'BaseDeDatos'.
4. El servidor responde enviando dicho bloque de texto plano bajo el formato MIME `application/json`.
5. El cliente procesa el string mediante `JSON.parse()`, actualiza las variables de estado e instruye el refresco de la interfaz gráfica. Si la petición falla por problemas de red, el sistema activa de manera transparente el modo de contingencia local leyendo las estructuras resguardadas en el `localStorage`.

### Operaciones de Escritura (POST)
1. Cada alteración del estado de las tareas (creación, edición, borrado o cambio de estado) gatilla la función asincrónica `saveData()`.
2. Esta rutina actualiza inmediatamente el `localStorage` para asegurar la respuesta local y despacha una petición HTTP `POST` hacia la URL de Apps Script.
3. El cuerpo del mensaje (`payload`) transporta el árbol jerárquico completo de tareas serializado en formato JSON string.
4. El método `doPost()` recibe el flujo de datos, ejecuta las validaciones correspondientes y sobrescribe por completo la celda A1, garantizando que el almacenamiento en la nube refleje con fidelidad absoluta el estado del cliente.

---

## Flujo de Integración Unidireccional con Google Calendar

El sistema cuenta con un mecanismo automatizado para agendar compromisos en la agenda personal del usuario, diseñado bajo el principio de intervención mínima y estabilidad del frontend.

### Principios del Diseño Unidireccional
* **Aislamiento del Frontend:** El archivo `app.js` desconoce por completo la existencia de Google Calendar. No realiza llamadas directas a su API ni añade sobrecarga de scripts en el cliente, manteniendo intacta la estabilidad de la aplicación web.
* **Inyección Pasiva en el Servidor:** La lógica de detección y despacho se ejecuta del lado del servidor dentro de `doPost()` antes de efectuar la escritura final en la hoja de cálculo.
* **Inmutabilidad Inversa:** Google Calendar actúa como un receptor ciego de información. No existe sincronización bidireccional; las modificaciones manuales realizadas directamente sobre la interfaz de Google Calendar jamás alterarán la base de datos de la aplicación.

### Criterios de Disparo y Procesamiento Recursivo
Cuando el backend recibe el JSON con el árbol de tareas, ejecuta una función de exploración recursiva denominada `procesarEventosCalendario()`. Esta rutina inspecciona cada nodo y subtarea evaluando estrictamente tres condiciones simultáneas:

1.  La tarea posee una fecha de vencimiento definida (`task.date`).
2.  La opción de notificación se encuentra activa en el modelo de datos (`task.reminder === true`).
3.  La tarea carece de un registro de sincronización previa (`!task.eventCreated`).

```
           [ payload JSON recibido en doPost() ]
                             |
                             v
               ¿Tiene fecha + recordatorio?
                       /           \
                    (Sí)           (No) ---> Ignorar nodo
                     /
                    v
          ¿Ya fue procesada antes? (task.eventCreated)
                       /           \
                    (No)           (Sí) ---> Ignorar nodo
                     /
                    v
       [ Invocar crearEventoSimple() ]
                     |
                     v
    [ Mutación: task.eventCreated = true ]
                     |
                     v
   [ Resguardo final del JSON en Sheets (A1) ]
```

Si el nodo cumple con los tres requisitos, se invoca al módulo `calendar.gs`, el cual utiliza el servicio nativo `CalendarApp` para instanciar el evento en el calendario predeterminado del usuario. Si la tarea incluye un horario (`task.time`), se genera un bloque con una duración fija de una hora; en caso contrario, se asienta como un evento de día completo.

### Prevención Absoluta de Duplicados
Para evitar que una misma tarea genere múltiples eventos en el calendario durante los sucesivos ciclos de guardado general, el script realiza una **mutación silente** sobre el objeto en memoria tras confirmar la creación exitosa del evento, añadiendo la propiedad `task.eventCreated = true`. Al reempaquetar el JSON que se guardará en la celda A1, esa bandera queda grabada de forma permanente. En el próximo ciclo de guardado, la tarea será omitida por el filtro de seguridad.

---

## Funcionalidades del Core Logic

### Sistema de Navegación y Vistas (SPA)
La aplicación se comporta como una *Single Page Application* gobernada de forma estricta por la variable de estado global `currentState`:
* **Vistas Temporales (`today`, `tomorrow`, `week`, `fortnight`):** Filtran dinámicamente el árbol de tareas pendientes comparando la fecha actual con el campo `date` de cada registro.
* **Vista por Áreas (`area`):** Agrupa y aísla las tareas según el área funcional asignada. Al abrir el panel de creación desde esta vista, el campo del formulario correspondiente al área se preselecciona automáticamente.
* **Historial de Navegación (`navHistory`):** Array que almacena el recorrido de estados del usuario, permitiendo un retorno seguro hacia la pantalla anterior mediante controles internos sin romper el ciclo de vida de la aplicación.

### Estructura de Tareas en Árbol
Los registros de las tareas no adoptan una estructura plana, sino un modelo de árbol jerárquico recursivo. Cada tarea constituye un nodo que puede albergar de forma indefinida un arreglo de subtareas (`subtasks`), las cuales heredan las propiedades de filtrado y contexto de sus nodos superiores pero mantienen estados de completado independientes.

---

## El Motor de Recurrencias

El sistema integra un algoritmo de proyección temporal personalizado ubicado en `app.js`, encargado de calcular con precisión matemática la siguiente ocurrencia de una tarea repetitiva dentro del huso horario local del navegador, neutralizando cualquier tipo de deriva horaria.

### Propiedades de la Regla de Recurrencia (`recurrenceRule`)
* `frequency`: Define la periodicidad de la serie (`daily` | `weekly` | `monthly` | `yearly` | `after_completion` | `custom`).
* `interval`: Multiplicador numérico que determina la cadencia (por ejemplo, "cada 3 días" o "cada 2 semanas").
* `baseOnCompletion`: Variable booleana que dicta el comportamiento del cálculo. Si es `false`, la nueva fecha de vencimiento toma como pivote la fecha de vencimiento original; si es `true`, calcula la nueva ocurrencia tomando como punto de partida la fecha real en la que el usuario completó la tarea.

### Mecánica de Resolución Histórica
Cuando una tarea con una regla de recurrencia activa es marcada como completada mediante la función `toggleTaskUniversal()`:
1. El motor calcula la fecha de la próxima ocurrencia invocando a `calculateNextOccurrence()`.
2. Se genera una copia idéntica e inmutable de la tarea en su estado de resolución actual: se le asigna el estado `'completed'`, se estampa la fecha y hora exacta en `completedAt` y se le extirpa la propiedad `recurrenceRule` para transformarla en un registro estático.
3. Esta copia histórica se inserta inmediatamente antes de la tarea original en la base de datos para preservar la trazabilidad de las acciones pasadas.
4. La tarea original actualiza su propiedad `date` con el valor futuro proyectado por el motor, restablece su estado operativo a `'pending'` y limpia de forma recursiva los estados de todas sus subtareas anidadas para dejarlas listas para el nuevo ciclo.

---

## Protocolo de Despliegue y Configuración Segura

Para enlazar la interfaz web de GitHub Pages con los servicios del backend sin provocar fallos de red o bloqueos de seguridad de tipo CORS, se debe seguir rigurosamente el siguiente orden metodológico:

1.  **Habilitación de Permisos:** En el editor de Google Apps Script, se debe acceder al archivo de manifiesto `appsscript.json` (activando la opción de visibilidad en la configuración del proyecto si no se encuentra expuesto) y verificar que el arreglo `oauthScopes` incluya la directiva `"https://www.googleapis.com/auth/calendar"`.
2.  **Aprobación de la Capa de Seguridad (OAuth):** Antes de ejecutar llamadas desde la aplicación web, es obligatorio seleccionar la función de diagnóstico `testCrearEvento` en el menú superior del editor de Apps Script y hacer clic en **Ejecutar**. Esto forzará a la plataforma de Google a desplegar la ventana emergente de seguridad para autorizar el acceso del script al calendario de la cuenta.
3.  **Publicación del Endpoint:** Cada vez que se guarde un cambio en `Codigo.gs` o `calendar.gs`, se debe crear una **Nueva implementación** desde el botón azul del editor.
    * *Tipo de extensión:* Aplicación web.
    * *Ejecutar como:* Yo (Tu cuenta de correo).
    * *Quién tiene acceso:* **Cualquier persona**. Esta selección es crítica; si se restringe a usuarios con cuenta de Google, el navegador interceptará la redirección de login invisible y abortará la comunicación emitiendo un `TypeError: NetworkError`.
4.  **Vinculación del Cliente:** La URL provista por el asistente de despliegue (cuya terminación debe ser estrictamente `/exec`) debe ser copiada e introducida en el panel de configuración de la agenda web (ícono del engranaje) para establecer el canal de comunicación persistente.

---

## Componentes Sensibles (Zonas de cuidado)

Existen estructuras algorítmicas nucleares que no deben ser modificadas bajo ninguna circunstancia sin un análisis de impacto previo, dado que cualquier alteración menor romperá la integridad de la base de datos:

* **`findAndMutateTask(taskId, mutationFn)`:** Función recursiva encargada de perforar el árbol jerárquico de tareas para localizar y alterar un nodo específico. Un cambio en su lógica anulará la capacidad de editar o completar subtareas.
* **`pruneTree(nodeList, inFocusedSubtree)` y `flattenMatches(prunedNodes)`:** Algoritmos que resuelven en tiempo real el filtrado combinado de la interfaz (texto, prioridades, contextos y estados). Si se alteran, las subtareas dejarán de renderizarse de manera consistente o los contadores numéricos de las vistas devolverán métricas erróneas.
* **`migrateAndNormalizeTasks()`:** Rutina de sanitización que se ejecuta en cada inicio del sistema. Adapta las estructuras antiguas al modelo de datos vigente y purga los elementos de la papelera de reciclaje que superen los 10 días de antigüedad. Alterar este bloque provocará fallos críticos de tipo *Runtime Error* al intentar leer registros antiguos que carezcan de las nuevas propiedades estandarizadas (como las banderas de calendario).
* **Bloque de Intercepción en `doPost(e)`:** El bucle recursivo encargado de procesar los eventos de calendario antes del guardado en Sheets es una zona crítica. No se deben añadir allí funciones de salida de texto que alteren los encabezados del objeto `ContentService`, ya que este no tolera métodos como `.setHeader()`, lo que causaría el colapso inmediato del servicio web.

---

## Recomendaciones de Integración para IA

Cuando se utilice un asistente de Inteligencia Artificial para dar soporte, corregir anomalías o desarrollar extensiones funcionales sobre esta aplicación, se le deben imponer las siguientes directrices operativas dentro del prompt:

1.  **Preservación del Enfoque Monolítico en el Cliente:** Para garantizar la simplicidad del despliegue y evitar problemas de hosting, la interfaz gráfica debe permanecer consolidada en un único archivo de ejecución (`app.js`). No se debe fragmentar el código del frontend en múltiples scripts de tipo módulo.
2.  **Uso Estricto del Estado Global:** Cualquier variable asociada a la visualización, ordenamiento o captura de datos debe incorporarse como una propiedad dentro de las estructuras globales existentes (`currentState`, `currentFilters`, `currentSort`). Queda prohibida la creación de variables globales dispersas que puedan generar colisiones en el ámbito compartido de ejecución.
3.  **Modularidad en el Backend:** La lógica de servicios avanzados de Google debe mantenerse estrictamente separada. Las funciones de comunicación con las APIs específicas de Google deben residir de forma exclusiva en sus archivos dedicados (como `calendar.gs`), limitando la intervención en `Codigo.gs` al punto de intercepción exacto dentro del flujo del `doPost`.
4.  **Sincronización Secuencial Obligatoria:** Todas las funciones desarrolladas que muten el estado de una tarea deben finalizar invocando de manera secuencial y obligatoria a `renderTasks()` y `await saveData()`, asegurando que el almacenamiento local y el registro remoto en la nube permanezcan perfectamente sincronizados ante cualquier evento.

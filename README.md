# agenda-leo
Agenda LMT

Gestor de Tareas Personal

Este proyecto consiste en una aplicación web autoportante para la gestión y organización de tareas cotidianas y profesionales. Su diseño prioriza la velocidad de ejecución y la simplicidad arquitectónica: se ejecuta por completo en el cliente mediante tecnologías web estándar y delega la persistencia de datos en una hoja de cálculo de Google Sheets a través de una pasarela intermedia construida en Google Apps Script.

La presente documentación sirve como mapa técnico para el desarrollo, mantenimiento futuro e inducción de asistentes de Inteligencia Artificial que colaboren en la evolución del software.

1. Arquitectura y Tecnologías

El sistema adopta una arquitectura desacoplada cliente-servidor de alta fidelidad y bajo acoplamiento:

Frontend (Cliente): * HTML5 y Tailwind CSS: Utilizados para la estructuración y el diseño de la interfaz gráfica de usuario. El estilo visual aprovecha variables de Tailwind para mantener una estética unificada.

Vanilla JavaScript (ES6+): Motor principal de ejecución. No se emplean dependencias de frameworks (frameworkless), lo que garantiza una carga instantánea y la ausencia de problemas de compatibilidad por dependencias desactualizadas.

Backend (Persistencia y Almacenamiento):

Google Sheets: Funciona como base de datos relacional simplificada de un solo registro.

Google Drive: Almacena los archivos adjuntos vinculados a las tareas en una carpeta dedicada.

Google Apps Script (GAS): Expone un servicio web mediante métodos doGet y doPost, actuando como el nexo que recibe, procesa y sirve las peticiones HTTP del cliente.

2. Estructura de Archivos del Proyecto

La distribución de componentes en el repositorio se organiza de la siguiente manera:

index.html: Estructura de la aplicación web y puntos de montaje para la interfaz gráfica. Contiene los formularios, vistas y modales de configuración.

app.js: Núcleo lógico del cliente. Gestiona el estado global de la aplicación, las mutaciones de tareas, los algoritmos de filtrado, renderizado en el DOM y la comunicación asincrónica con el servidor.

Codigo.gs (o codigo_script.js): Código de ejecución para Google Apps Script que procesa los eventos HTTP del backend.

appsscript.json: Manifiesto de configuración de Apps Script que declara los permisos Oauth necesarios para interactuar con Google Drive y Sheets.

Guías Auxiliares (github_setup_guide.md, gemini_api_guide.md, apps_script_guide.md): Instrucciones detalladas de despliegue y aprovisionamiento de credenciales para el usuario final.

3. Flujo de Sincronización con Google Sheets

La persistencia de datos evita la complejidad de múltiples filas para cada tarea mediante una estrategia de almacenamiento en un único bloque de texto serializado:

[ Cliente (app.js) ]                             [ Google Apps Script (doPost) ]          [ Google Sheets ]
        |                                                       |                                |
        | -- POST (JSON completo en texto plano) -------------> | -- Escribe JSON en Celda A1 -> |
        |                                                       |                                |
        | -- GET (Petición de lectura) -----------------------> | <--- Lee Celda A1 -------------|
        | <------ Devuelve array JSON parsed ------------------ |                                |


Operaciones de Lectura (GET):

Al iniciar la aplicación, si existe una URL de base de datos configurada, se ejecuta loadDataFromCloud().

El cliente realiza una petición HTTP GET a la dirección web del Apps Script.

El método doGet() del script lee el valor textual contenido exclusivamente en la celda A1 de la hoja 'BaseDeDatos'.

El script responde al cliente enviando ese bloque de texto plano con formato MIME application/json.

El cliente procesa el JSON (JSON.parse) y refresca la interfaz. Si la petición falla, se activa de manera transparente el modo de contingencia local (offline) leyendo de localStorage.

Operaciones de Escritura (POST):

Cada alteración del estado local (creación, edición, cambio de estado o eliminación de tareas) gatilla la función saveData().

Esta función actualiza la clave en el almacenamiento local (localStorage) e inicia una petición asincrónica HTTP POST hacia la URL del Apps Script.

El cuerpo del mensaje contiene el árbol completo de tareas serializado en formato JSON.

El método doPost() de Apps Script recibe el texto y sobrescribe por completo el contenido de la celda A1, garantizando que el almacenamiento remoto refleje fielmente el estado del cliente.

4. Funcionalidades del Core Logic

Sistema de Navegación y Vistas:

La aplicación se comporta como una SPA (Single Page Application) controlada por la variable de estado global currentState:

Vistas Temporales (today, tomorrow, week, fortnight): Filtran dinámicamente el listado de tareas pendientes según su fecha de vencimiento (date).

Vista por Áreas (area): Agrupa las tareas según el área funcional a la que pertenecen. Al abrir el creador de tareas desde aquí, el campo de área se preselecciona automáticamente.

Historial (navHistory): Array de estados que permite una navegación segura hacia atrás mediante el botón de retroceso sin recargar la aplicación.

Estructura de Tareas en Árbol:

Las tareas no son registros planos; soportan una estructura anidada recursiva (árbol jerárquico de tareas y subtareas). Cada nodo cuenta con un arreglo opcional subtasks que puede albergar a su vez otras subtareas.

5. El Motor de Recurrencias

El sistema integra un motor de proyección temporal personalizado ubicado en app.js (basado en el diseño detallado en recurrent_tasks_proposal.md y probado en recurrence_engine.js). Este algoritmo calcula de forma exacta la siguiente ocurrencia de una tarea en el huso horario local del navegador, evitando derivas horarias.

Propiedades de la Regla de Recurrencia (recurrenceRule):

frequency: Tipo de serie ('daily' | 'weekly' | 'monthly' | 'yearly' | 'after_completion' | 'custom').

interval: Multiplicador numérico (ej. "cada 3 días" o "cada 2 semanas").

baseOnCompletion: Boolean que determina si la siguiente fecha de vencimiento se calcula tomando como pivote la fecha de vencimiento original (false) o la fecha real en la que el usuario marcó la tarea como completada (true).

Mecánica de Resolución:

Cuando una tarea que cuenta con una recurrenceRule activa es completada (toggleTaskUniversal):

El motor calcula la próxima fecha de vencimiento mediante calculateNextOccurrence().

Se genera una copia inmutable de la tarea en su estado actual, se le asigna el estado 'completed', se marca la fecha de resolución en completedAt y se elimina su regla de recurrencia para que quede fijada en el historial.

Esta copia histórica se inserta inmediatamente antes de la tarea original en la base de datos para preservar el registro histórico.

La tarea original actualiza su fecha programada al valor proyectado por el motor y restablece su estado a 'pending'. Además, todas sus subtareas anidadas vuelven recursivamente al estado pendiente.

6. Flujo de Trabajo Seguro para Modificaciones

Si estás planificando realizar modificaciones sobre el código de la aplicación, o si le estás pidiendo asistencia a un modelo de IA para hacerlo, asegurate de seguir el siguiente protocolo de seguridad:

Respaldar Datos: Antes de efectuar cambios de código que alteren la lógica de inicialización, utilizá el botón de exportación en la barra lateral para descargar un backup en formato .json de tus tareas actuales.

Ciclo de Pruebas Locales:

Probá que el renderizado de la interfaz (renderTasks()) no presente retrasos perceptibles.

Confirmá que las subtareas creadas hereden el comportamiento de sus padres en cascada.

Comprobá la inicialización de formularios en distintas vistas temporales y de áreas.

Control de Commits: Realizá confirmaciones incrementales de cambios enfocados en un único archivo a la vez. No mezcles modificaciones de interfaz de usuario con alteraciones del motor lógico de persistencia.

7. Componentes Sensibles (Zonas de cuidado)

Existen estructuras algorítmicas dentro de app.js que no deben ser modificadas de manera descuidada, ya que un cambio menor puede corromper la consistencia de toda la base de datos:

findAndMutateTask(taskId, mutationFn): Es la función recursiva encargada de recorrer todo el árbol de tareas para aplicar cambios en un nodo específico sin importar su nivel de anidamiento. Cualquier alteración a su algoritmo de búsqueda romperá la edición y el completado de subtareas.

pruneTree(nodeList, inFocusedSubtree) y flattenMatches(prunedNodes): Estos algoritmos filtran en tiempo real el árbol de tareas evaluando los filtros de texto, contextos, prioridad y estados activos. Alterarlos causará que las subtareas dejen de visualizarse adecuadamente o que los contadores de tareas devuelvan números inconsistentes.

migrateAndNormalizeTasks(): Se ejecuta en cada inicio del sistema. Se encarga de adecuar las estructuras antiguas al esquema moderno y de eliminar elementos de la papelera que superen los 10 días de antigüedad. Si se modifica o se elude este paso, los clientes con bases de datos preexistentes podrían sufrir fallos críticos de tipo Runtime Error por llamadas a propiedades inexistentes o tipos indefinidos.

8. Recomendaciones de Integración para IA

Cuando uses un asistente de IA para expandir o dar soporte a esta aplicación, proporcionale las siguientes directrices operativas dentro del prompt:

Preservación del Modelo Unificado: La aplicación se despliega como un archivo monolítico en producción para simplificar el hosting. Todo el Javascript debe estar unificado dentro de app.js.

Uso de Variables de Estado: Cualquier nueva propiedad de visualización debe integrarse dentro de las variables globales de estado existentes (currentState, currentFilters, currentSort). Evitá la declaración de variables globales dispersas que puedan provocar colisiones de ámbito.

Sincronización Transparente: Todas las funciones de creación, eliminación y mutación de tareas deben finalizar llamando a renderTasks() y await saveData() de forma secuencial, garantizando la consistencia del almacenamiento local y en la nube en todo momento.

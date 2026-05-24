# Directrices Operativas para Modelos de Inteligencia Artificial
## Manual de Evolución, Mantenimiento Seguro y Restricciones Arquitectónicas

Este documento constituye un conjunto de instrucciones permanentes, taxativas e ineludibles para cualquier modelo de Inteligencia Artificial (IA) que asista en la modificación, expansión o depuración del código fuente de esta aplicación de gestión de tareas. 

La aplicación opera bajo un delicado equilibrio jerárquico recursivo (estructura en árbol de tareas y subtareas) y un sistema de sincronización sincrónica unidireccional y bidireccional con servicios en la nube (Google Sheets, Google Drive y Google Calendar). Cualquier alteración imprevista en las estructuras de control o en los nombres de variables romperá la persistencia de datos o causará regresiones críticas en la interfaz.

Por lo tanto, la IA debe leer, asimilar y acatar estrictamente las siguientes directivas antes de proponer cualquier línea de código.

---

## 1. Mandatos de No Intervención (Líneas Rojas Absolutas)

Queda terminantemente prohibido realizar modificaciones automáticas o no solicitadas explícitamente en los siguientes componentes:

* **Prohibición de Refactorización Estructural:** No se debe refactorizar, reescribir o "limpiar" el código bajo criterios genéricos de estilo, a menos que el usuario lo solicite con una orden directa y explícita. El código actual es funcional y estable; la legibilidad pragmática prima sobre el purismo estético.
* **Preservación de la Arquitectura Monolítica en el Cliente:** La aplicación web está diseñada para desplegarse como un único archivo lógico (`app.js`) en producción para simplificar el hosting y evitar la sobrecarga de módulos. No se deben fragmentar las funciones en múltiples archivos ni implementar sistemas de empaquetado (*bundlers*) de forma autónoma.
* **Inmutabilidad de Identificadores y Nombres Sensibles:** No se deben alterar los nombres de las funciones nucleares, constantes de configuración, IDs de elementos del DOM ni las claves del almacenamiento local (como `leo_agenda_v11`, `DB_URL_KEY`, `SHEET_NAME`, etc.). Cambiar estos identificadores desincronizará las bases de datos existentes de los usuarios.
* **Integridad del Canal de Sincronización (Sheets/Drive):** El flujo de comunicación estructurado a través de `doGet` y `doPost` en `Codigo.gs` que lee y escribe el JSON completo en la celda A1 debe permanecer intacto. No se debe intentar fragmentar el guardado por filas o alterar el manejo de adjuntos multimedia sin autorización previa.
* **Blindaje del Motor de Recurrencias:** El algoritmo de cálculo temporal y duplicación histórica inmutable alojado en `app.js` (`calculateNextOccurrence` y asociados) regula la proyección de tareas repetitivas sin desvíos de huso horario. Es una zona crítica; cualquier modificación aquí puede corromper el árbol jerárquico de forma irreversible.

---

## 2. Criterios de Diseño e Ingeniería de Software

Al introducir nuevas funcionalidades o corregir anomalías, la IA debe regirse por los siguientes principios operativos:

* **Priorización de Estabilidad sobre Optimización:** Es preferible un algoritmo lineal y explícito que conserve la predictibilidad del sistema antes que una solución altamente optimizada pero compleja que introduzca opacidad en el rastreo de errores (*debugging*).
* **Política de Cambios Mínimos Necesarios (Enfoque Quirúrgico):** La propuesta de código debe limitarse exclusivamente a resolver el requerimiento solicitado. No se deben añadir funciones accesorias, decoradores innecesarios ni "mejoras de rendimiento" colaterales que expandan la superficie de ataque de errores.
* **Retención de Código Redundante o de Respaldo:** Si se detecta un bloque de código, una variable o una función que parezca huérfana o redundante, **no se debe eliminar** a menos que se indique explícitamente. Esos bloques suelen actuar como contingencias (*fallbacks*) para la retrocompatibilidad de estructuras de datos antiguas.
* **Compatibilidad Adaptativa (Responsive) y Consistencia Visual:** La interfaz gráfica utiliza Tailwind CSS de forma nativa. Cualquier elemento nuevo en el DOM debe heredar las variables de estilo, la paleta cromática y las clases de diseño responsivo preexistentes, asegurando que la visualización sea consistente tanto en dispositivos móviles como en pantallas de escritorio.

---

## 3. Protocolo de Entrega y Explicación de Cambios

Cuando la IA presente una solución técnica, deberá ajustarse al siguiente protocolo de comunicación para mitigar el riesgo de errores de integración por parte del usuario:

* **Devolución de Archivos Completos:** Al modificar un archivo (`app.js`, `Codigo.gs`, `calendar.gs` o `index.html`), la IA **debe proporcionar el archivo completo actualizado**, o en su defecto, bloques de código lo suficientemente extensos y contextualizados que incluyan comentarios claros sobre dónde realizar la inserción. Se deben evitar los fragmentos ambiguos o las indicaciones abstractas como `// ... resto del código ...` en zonas críticas.
* **Mapeo Exhaustivo de Modificaciones:** Se debe incluir una explicación inicial concisa y técnica que detalle con precisión quirúrgica:
    1. Qué archivos fueron alterados.
    2. Qué funciones específicas fueron añadidas o modificadas.
    3. El impacto esperado de dicho cambio sobre el flujo general de la aplicación.

---

## 4. Protocolo de Flujo de Trabajo Seguro (Recomendaciones para el Operador)

Para garantizar que la aplicación mantenga su operatividad durante los ciclos de actualización, la IA recordará activamente al usuario la ejecución del siguiente protocolo de seguridad antes de implementar los cambios en el entorno de producción:

### Paso 1: Resguardo de Datos (Backup Remoto y Local)
Antes de aplicar cualquier modificación en `app.js` o en los scripts de Google, se debe instruir al usuario a utilizar la función de exportación de la barra lateral de la aplicación para descargar el estado actual del árbol de tareas en un archivo físico `.json`. Esto previene la pérdida de información ante fallos de sanitización en el inicio del sistema.

### Paso 2: Aislamiento en el Entorno de Pruebas
Los cambios en el backend de Google Apps Script nunca deben sobreescribir la implementación de producción de manera inmediata. Se debe crear un entorno de pruebas duplicando la planilla o utilizando el modo de prueba de Apps Script para validar los endpoints mediante herramientas de diagnóstico o la ejecución manual de funciones testigo (como `testCrearEvento`).

### Paso 3: Control de Commits Incrementales
Las confirmaciones de cambios en el repositorio de GitHub deben realizarse de forma atómica e incremental. 
* No mezclar modificaciones visuales de la interfaz (`index.html` / clases CSS) con alteraciones en las funciones de mutación del estado lógico de las tareas.
* Cada cambio estructural debe estar respaldado por un commit específico, facilitando la reversión inmediata (*rollback*) en caso de detectar regresiones imprevistas.

### Paso 4: Matriz de Verificación antes de Producción
Antes de dar por concluida una actualización, se debe comprobar empíricamente que:
1. El renderizado del DOM (`renderTasks`) se ejecute sin latencia perceptible.
2. Las subtareas anidadas hereden de forma recursiva los filtros de estado y área de sus nodos padres.
3. El modo de contingencia local (*offline*) se active correctamente al interrumpir el flujo de red, recurriendo de forma transparente al `localStorage`.

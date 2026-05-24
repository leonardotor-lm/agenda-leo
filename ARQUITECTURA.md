# Documentación de Arquitectura e Ingeniería de Software

## Sistema de Gestión de Tareas - Arquitectura Desacoplada

Este documento técnico funciona como mapa estructural y manual de referencia para comprender el diseño lógico, los flujos de datos y los módulos de automatización de la aplicación. Su propósito principal es asegurar la consistencia operativa del sistema en el mediano y largo plazo, sirviendo de guía para operadores humanos y asistentes de Inteligencia Artificial que participen en futuros procesos de mantenimiento o extensión de funciones.

## 1. Descripción General de la Aplicación

La aplicación es un gestor personal de tareas jerárquicas diseñado bajo la premisa de *Local-First, Cloud-Synced* (Prioridad Local, Sincronización en la Nube). Su objetivo es proporcionar una interfaz de alta velocidad para la organización de compromisos cotidianos y profesionales, reduciendo a cero los tiempos de carga mediante un entorno libre de frameworks (*frameworkless*).

### Enfoque de Diseño

El sistema prioriza la simplicidad y la durabilidad tecnológica. Al ejecutarse directamente en el cliente y utilizar servicios estandarizados en la nube de Google, se elimina la necesidad de mantener servidores dedicados, bases de datos complejas o dependencias externas que queden obsoletas con el tiempo. El almacenamiento se comporta de manera transparente: ante fallos de conexión o ausencia de red, el sistema opera localmente y resguarda los cambios de forma diferida en el almacenamiento local del navegador, sincronizándolos en la nube tan pronto como se restablece la comunicación.

### Stack Tecnológico

* **HTML5:** Proporciona la estructura semántica de la interfaz de usuario, los formularios de entrada de datos y los contenedores dinámicos del DOM.

* **Tailwind CSS:** Resuelve el diseño visual de la interfaz. Se utiliza de manera nativa mediante clases de utilidad, garantizando un diseño responsivo, limpio y cohesivo sin necesidad de hojas de estilo pesadas.

* **Vanilla JavaScript (ES6+):** Controla el estado global de la aplicación, el procesamiento del árbol jerárquico de tareas, el motor de recurrencias y el cliente de comunicación asincrónica (`fetch`).

* **Google Sheets:** Actúa como la base de datos persistente no relacional del sistema, almacenando el estado completo de la agenda en un único bloque serializado.

* **Google Drive:** Funciona como el depósito exclusivo para los archivos multimedia adjuntos asociados a las tareas.

* **Google Calendar:** Registra de manera automatizada las tareas elegibles en la agenda personal del usuario en formato de eventos de día completo o bloques horarios concretos.

* **Google Apps Script (GAS):** El entorno de ejecución del lado del servidor que expone una API REST para procesar la lectura, escritura y derivación de servicios en la nube.

## 2. Organización Actual del Proyecto

El sistema está organizado bajo un esquema de responsabilidades desacopladas para mantener la modularidad y simplificar el mantenimiento:

```text
[Cliente / Frontend]                       [Servidor / Google Cloud]
├── index.html                             ├── Codigo.gs (API Router / Sheets)
├── app.js (Estado y Lógica)               └── calendar.gs (Calendar Wrapper)
└── (styles.css / Tailwind)
# Esports Tournament Manager 🏆🎮

[![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4fc08d?style=for-the-badge&logo=vue.js&logoColor=white)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-7.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Services-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)

**Esports Tournament Manager** es una plataforma web moderna y reactiva diseñada para simplificar la organización, gestión y seguimiento de torneos competitivos de videojuegos. Ofrece una experiencia fluida tanto para organizadores (administración de grupos, brackets de playoffs, control de jugadores y asignación de partidas) como para competidores (chat interactivo en tiempo real, perfiles de jugador, calendarios de juego y tablas de posiciones automatizadas).

---

## 🚀 Características Clave

### 🛡️ 1. Panel de Administración del Torneo (Backoffice)
Control total de la competencia de forma centralizada:
* **Gestión de Jugadores/Equipos:** Aprobación de solicitudes de inscripción y edición de perfiles competitivos.
* **Fase de Grupos (Groups View):** Creación interactiva de grupos, asignación automática o manual de competidores y cálculo reactivo de puntajes (puntos, victorias, derrotas).
* **Fase de Eliminación Directa (Playoffs Bracket):** Generación automática de llaves de eliminación (cuartos, semifinal, final) con avance automático al registrar el ganador de cada encuentro.
* **Marcadores en Tiempo Real:** Actualización de resultados de partidas con reflejo inmediato en el feed público.

### 🎮 2. Experiencia del Jugador y Participante
Área dedicada para que los competidores sigan el torneo:
* **Tablero Centralizado (Dashboard):** Vista global con noticias, anuncios destacados y el estado actual de las fases de juego.
* **Calendario de Partidas (Calendar View):** Cronograma interactivo de enfrentamientos futuros, indicando horas, rivales y estados de juego (pendiente, jugando, terminado).
* **Perfil Competitivo (Profile Card):** Estadísticas de victorias, historial personal de partidas y personalización del equipo/avatar.

### 💬 3. Comunicación Social en Tiempo Real
* **Chat Global Integrado:** Sala de conversación unificada para que los jugadores interactúen, organicen horarios de partida y reciban soporte al instante de los administradores con persistencia en tiempo real.
* **Gestor de Notificaciones:** Sistema dinámico para anunciar el inicio de partidas, cambios de reglas o resultados de manera instantánea.

---

## 🛠️ Stack Tecnológico

* **Frontend:** Vue.js 3 (Composition API con Script Setup)
* **Build Tool:** Vite (compilación y optimización ultra rápidas)
* **Estilos:** Tailwind CSS v4 + PostCSS (diseño adaptativo oscuro y animaciones fluidas)
* **Router:** Vue Router (enrutamiento seguro entre dashboards, vistas de admin y jugador)
* **Backend de Datos:** Firebase Firestore & Realtime Database (para la reactividad instantánea del chat y los brackets)
* **Autenticación:** Firebase Authentication (registro e inicio de sesión seguro para administradores y jugadores)

---

## 📁 Estructura del Proyecto

```text
esports-tournament-platform/
├── src/
│   ├── components/      # Componentes UI reutilizables (Chat, Sidebar, Carruseles)
│   ├── router/          # Enrutamiento SPA seguro con guardianes de roles
│   ├── views/           # Vistas principales (Dashboard, Login/Registro)
│   │   ├── admin/       # Vistas de organización (Brackets, Grupos, Marcadores)
│   │   └── player/      # Vistas del competidor (Calendario, Perfiles, Brackets públicos)
│   ├── firebase.js      # Inicialización y configuración de Firebase SDK
│   └── main.js          # Punto de entrada de la aplicación Vue
├── package.json         # Dependencias y scripts de ejecución
└── vite.config.js       # Configuración del empaquetador Vite
```

---

## ⚙️ Configuración y Despliegue Local

### Requisitos
* [Node.js](https://nodejs.org/) v18 o superior.
* Un proyecto creado en la consola de [Firebase](https://console.firebase.google.com/).

### Instalación
1. Clona el proyecto o sitúate en su carpeta raíz.
2. Instala las dependencias necesarias:
   ```bash
   npm install
   ```
3. Registra las credenciales de tu aplicación web de Firebase en el archivo:
   [`src/firebase.js`](file:///f:/masturbanda-league-cup/src/firebase.js)
4. Inicia la aplicación en modo desarrollo:
   ```bash
   npm run dev
   ```
5. Abre la aplicación en tu navegador en `http://localhost:5173`.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**. Siéntete libre de adaptarlo y usarlo para tus propios torneos locales.

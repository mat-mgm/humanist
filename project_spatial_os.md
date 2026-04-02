# Project Spatial OS

## Overview
A spatial operating system interface and backend.
* Purpose: A local-first, "Git for Data" Multimodal Intelligence Platform, managing nodes, edges, and blobs through generic, trait-based representations. It provides a unified environment to explore, interact with, and interconnect data, nodes, and spatial elements using a local database, PROLOG engine, and a window-managed GUI.
* Context: Built using a Rust backend internally structured with Hexagonal Architecture. It exposes functionality via a Tauri wrapper for the GUI and a CLI binary. The web-based frontend uses React, Vite, TypeScript, and Zustand. All environments are reproducible via NixOS `flake.nix`.
* Scope: Includes a CAS system, Prolog-based logic, DWM-style tiling window manager using `flexlayout-react`, a graph node viewer, a 3D globe viewer, properties panel, and an integrated terminal.

## Status
Current status: in-progress
Start date: 
Last updated: 
Priority: High

State rules:
* initiated/defined -> defined requirements exist
* in-research -> unknowns actively explored
* in-progress -> execution ongoing
* waiting condition -> blocked externally
* completed/finished -> goals met & verified

## Goals
* Goals: Create a highly interactive, keyboard-centric interface integrating graph visualization, 3D geographic data, property inspection, and a programmable terminal.
* Success criteria: Stable graph editing/viewing resisting layout transitions, functional 3D globe with satellite imagery, flawless DWM-like window management within the app, reliable CAS and Prolog backend integration.
* Constraints / priorities: Must run locally and efficiently. High performance 3D globe using Cesium, preventing massive bottlenecks by using pre-signed URLs for blobs.

## Architecture
* Structure: Monorepo Cargo Workspace adopting Hexagonal Architecture.
* Components / assets:
  - **`core_engine` (Library)**: The embedded database logic using SurrealDB, blob storage via `aws-sdk-s3`, background garbage collection (simulating `git gc`), and a unified Tokio `EventBus`. Exposes operations exclusively via traits like `GraphDatabase`.
  - **`os_cli` (Binary)**: Fast, headless terminal interface built with `clap` for automations and mass data ingestion.
  - **`os_gui` (Binary)**: Tauri 2.0 app with a Rust backend handling IPC commands. React frontend using atomic Zustand selectors for high-performance reactive UI updates, allowing 3D WebGL scenes to run isolated without stalling the main loop. Uses React Error Boundaries.
* Layout Matrix: 
  - Left Pane: Knowledge Graph (`force-graph`) and Entity Registry.
  - Right Pane: 3D Globe (`cesium`) and Properties/Preview panel.
  - Floating Terminal Overlay (`xterm.js`).
* Ontology & Traits: Uses client-generated ULIDs and soft deletes. Data is generic and augmented by traits (`Entity`, `Spatial Trait`, `Blob Trait`). Context entities emit semantic edges.

## Roadmap

### General conditions
Execution context: Local application built with Tauri, Rust, Vite, React. Theme-able frontend.

### Phase 1: Prolog & Database Foundation
**Description**
Establish the core data and logic backend, ensuring Prolog integration and CAS functionality.

**Tasks**
- [✓] Choose between Trealla and Scryer Prolog and integrate Trealla.
- [✓] Verify Prolog consistency for statement storage via syntactic consistency checks.
- [✓] Package Prolog executable statically (embedding C strings and custom implementations).
- [✓] Develop and test CAS system functionality, including tracking blobs.

**Checks**
- [✓] CAS tests (create, list, verify presence, remove) pass successfully.
- [✓] Statements in DB are successfully parsed back as valid Prolog terms.

### Phase 2: GUI Window Manager & Framework
**Description**
Implement a DWM-like tiling window manager inside the Tauri application to organize panels using `flexlayout-react`.

**Tasks**
- [✓] Establish top "View" menu bar and remove default desktop window decorations.
- [✓] Implement custom window layouts (master-stack, centered-stack, monocle, grid).
- [✓] Leave gaps between panels and hide grey lines.
- [✓] Add configurable keybindings for moving focus between panels, opening/closing, and layout manipulation.
- [✓] Make the application themable (light theme default, midnght, solarized, dark).

### Phase 3: Terminal & Viewport Integration
**Description**
Add integrated CLI access and a tabbed properties inspector for diverse assets.

**Tasks**
- [✓] Integrate `xterm.js` for the floating terminal panel over existing views.
- [✓] Add command history, arrow navigation, copy/paste functionality.
- [✓] Include interactive command shells mapped to native backend commands (help, echo, ping, whoami, date, clear).
- [✓] Convert preview panel to a tabbed interface (Properties, Entity Registry).
- [✓] Add diverse file preview capabilities: images, PDFs, and 3D CAD models (GLTF).
- [✓] Fix GLTF rendering instabilities: 3D objects should no longer disappear on panel resize, adding a reload/reset view button.

### Phase 18: Reliable Data Persistence (Backend Knowledge Graph)
**Description**
Fix the underlying data model in the core engine to correctly persist and retrieve graph edges, ensuring ULIDs translate to valid SurrealDB types.

**Tasks**
- [✓] Redefine the `edge` table schema to natively use `TYPE RELATION IN entity OUT entity` for SurrealDB optimized graph queries.
- [✓] Guard ID Interpolation: Apply native backtick escaping for Record ID references (e.g., ``entity:`{ID}` ``) so parsed ULIDs skip type literal crashes.
- [✓] String-Safe Edge Fetching: Cast `in` and `out` to strings in SQL queries to fix crash-on-serialization of IDs in Tauri payloads.
- [✓] Remove `#[serde(skip)]` in models where applicable to pass ID state properly.

**Checks**
- [✓] CLI validates that `in` and `out` edge vertices map accurately mapping to ULID strings (none are null).
- [✓] Graph GUI displays edges without showing exactly "0 edges".

### Phase 19: UI Layout Stability and Physics Integrity
**Description**
Prevent chaotic node physics crashes and missing elements upon panel layout changes resulting in component remounts.

**Tasks**
- [✓] Store global `nodePositions` using a Zustand state proxy to persist coordinates across panel unmounts.
- [✓] Refactor frontend link-resolution logic to reliably re-draw edges on Graph remount.
- [✓] Implement rigid `null` and `NaN` filtering boundaries in node/edge loops to prevent phanton D3 simulation crashes across transition states.

**Checks**
- [✓] Nodes stably persist their dragged coordinates even after hot-swapping DWM layouts (e.g., Master to Monocle).

### Phase 20: Visual & Aesthetic Polish 
**Description**
Enhance standard Graph Panel visualization components and adapt them for customized aesthetics.

**Tasks**
- [✓] Implement a major/minor background spatial grid system that reacts accurately to D3 zooming/panning scaling.
- [✓] Integrate variables natively via CSS properties to automatically react to active theme state (Edges, Selection Rings, Grid, Node backgrounds).
- [✓] Adjust selection feedback: Apply a thick, non-expanding accented stroke circle for actively selected semantic nodes.
- [✓] Render images efficiently directly onto graph nodes.
- [✓] Freeze text scaling ratios to resist excessive UI clutter at far zoom lengths.

### Phase 21: 3D Globe Implementation
**Description**
Build an interactive 3D globe using CesiumJS to visualize coordinates and associated data, substituting static Leaflet versions.

**Tasks**
- [✓] Bootstrap CesiumJS in a sandboxed, lazily-loaded React Suspsense component (eliminating blank app loading screens).
- [✓] Integrate offline rendering using the integrated `NaturalEarthII` baseline imagery texture via Vite static asset plugins.
- [✓] Overlay high resolution Google Earth-style photorealistic satellite imagery (`ArcGisMapServerImageryProvider`).
- [✓] Display active graph/registry entities synchronously mapped to point primitives, adapting dynamically.
- [✓] Fly terrain camera efficiently to selected map tag location upon node/table selection seamlessly.

**Checks**
- [✓] Cesium renders fully self-contained cleanly without authentications, Ion tokens, nor leaking DOM metadata credits.

### Phase 22: Blob Ingestion & System Stability
**Description**
Resolve blob ingestion issues and garbage collection instability to ensure reliable storage and Graph rendering.

**Tasks**
- [✓] Fix "No BlobTrait attached" errors when previewing blobs in the GUI.
- [✓] Ensure relative paths work correctly for the ingestion CLI tools.
- [✓] Fix garbage collection (GC) crashes caused by closed channels that prevented the knowledge graph from rendering.

### Phase 23: Terminal UI & Thematic Integrity
**Description**
Perfect the aesthetics and theme responsiveness of the integrated floating terminal.

**Tasks**
- [✓] Enhance terminal transparency by configuring `allowTransparency` and `#00000000` overrides in `xterm.js`.
- [✓] Make the terminal text and cursor colors seamlessly adapt to global application theme changes.
- [✓] Implement a `MutationObserver` to actively listen for `data-theme` changes on the DOM, dynamically updating Xterm options without remounting.
- [✓] Add native support for 6 canonical popular themes (Catppuccin Mocha/Latte, Dracula, Tokyo Night, Solarized Dark/Light) and 3 highly requested ones (Nord, Gruvbox Dark, GitHub Light).

### Phase 24: Robust Terminal Emulation & Native Clipboard
**Description**
Upgrade the rudimentary xterm.js echo simulation into a robust, keyboard-navigable terminal interface with standard quality-of-life CLI features.

**Tasks**
- [✓] Implement command history array navigable via Up/Down arrow keys.
- [✓] Enable granular cursor positioning and inline text insertion/deletion via Left/Right arrow keys.
- [✓] Support explicit standard terminal clipboard commands: `Ctrl+Shift+C` (copy) and `Ctrl+Shift+V` (paste), ensuring they yield properly to the browser's native async `navigator.clipboard` APIs.
- [✓] Ensure `Ctrl+C` accurately acts as an interrupt signal (`^C`) when triggered natively.
- [✓] Use `document.execCommand('copy')` as a robust fallback to guarantee copying text works synchronously within xterm's hidden textarea, bypassing Tauri's rigid environment permission snags on async clipboard writes.

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

## Developer Agent Persona
You are a pragmatic systems fullstack engineer who strictly adheres to the suckless coding philosophy and modular design principles. You prioritize minimalism, raw performance, and mathematical correctness, building software as a composition of small, independent, and interchangeable parts rather than monolithic structures.

* Suckless Philosophy: Write code that is simple, clear, and does exactly what is required without unnecessary bloat, trendy abstractions, or complex dependencies.
* Modular Design: Construct independent components with strictly defined inputs and outputs that can be easily tested, swapped, or repurposed.
* Composability: Design systems that function like well-oiled pipelines, where small, reliable tools work together to solve complex problems cleanly.
* Separation of Concerns: Keep interface layers completely decoupled from core logic, ensuring changes in one domain do not bleed into another.
* Zero-Warning Standard: Treat compiler warnings as errors, write robust and safe code, and prioritize long-term stability over rapid, messy feature delivery.

### System-specific criteria
* Strict Hexagonal Discipline: Completely separate the core domain logic from external interfaces, keeping the SurrealDB storage and Tauri IPC gateways isolated from the core engine.
* Trait-Driven Ontology: Utilize composable traits for data mutation and polymorphism rather than sparse tables or rigid object inheritance.
* Symmetrical Interfaces: Maintain exact feature parity between the headless Clap CLI and the Tauri-based React GUI environments.
* Local-First Efficiency: Rely on local embedded data stores, pre-signed URLs for blobs, and avoid external network bottlenecks for rendering and state tracking.
* Verification Driven Workflow: Commit strictly to the defined roadmap phases, passing all defined checks and waiting for explicit user confirmation before proceeding.

## Development Guidelines
* Environment: Use Nix flakes (`nix develop`) to setup the dependencies. Enter the nix shell once and perform all development inside it to prevent re-accessing every time.
* Version Control: Use `git` to track changes. Commit every time a new phase or feature is implemented and verified to work as expected.
* Workflow: After each phase implementation is done, wait for explicit user confirmation before marking the verification boxes in the roadmap and committing. Commits should be coherent with phases.
* Style: Use suckless coding style and robust coding practices.
* Warnings: Always address and fix compiler warnings.
* Roadmap Expansion: Once all currently defined phases are complete, expand the roadmap with consequent development phases and verification plans.

## Architecture
* Structure: Monorepo Cargo Workspace adopting Hexagonal Architecture.
* Components / assets:
  - **`core_engine` (Library)**: The embedded database logic using SurrealDB, blob storage via `aws-sdk-s3`, background garbage collection (simulating `git gc`), and a unified Tokio `EventBus`. Exposes operations exclusively via traits like `GraphDatabase`.
  - **`os_cli` (Binary)**: Fast, headless terminal interface built with `clap` for automations and mass data ingestion.
  - **`prolog_engine` (Library)**: Dedicated standalone component executing the Scryer Prolog Inference Engine, interoperating with the Core EventBus.
  - **`os_gui` (Binary)**: Tauri 2.0 app with a Rust backend handling IPC commands. React frontend using atomic Zustand selectors for high-performance reactive UI updates, allowing 3D WebGL scenes to run isolated without stalling the main loop. Uses React Error Boundaries.
* Ontology & Traits: Uses client-generated ULIDs and soft deletes. Data is generic and augmented by traits (`Entity`, `Spatial Trait`, `Blob Trait`, `Temporal Trait`). Context entities emit semantic edges.
* **Temporal Causal Context Tracking**: Entities of the `temporal` kind can be associated with a `Temporal Trait` (supporting points, spans, and recurring events). The **Timeline Panel** provides a synchronized visual representation, allowing for causal context tracking where Selecting a node in any view highlights its temporal position.
* **Unified Semantic Relationships (Graph Edges & Tags)**: 
  - To achieve a true "Git for Data" mental model, all relationships (1:1 and Many:1) are merged into a single generic **Edge** mechanism. 
  - **Relational Tagging**: Tags are no longer static string arrays inside an entity's record. Instead, they are independent `Abstract` entities. 
  - Tagging an entity creates a directed edge (`tagged_as`) from the target to the tag node. This allows for complex graph traversal using tags as central hubs, rather than simple metadata filtering. 
  - Removing a tag merely deletes the relationship edge, preserving the tag's identity as a first-class citizen in the knowledge graph.
* Rules Engine: Integrates Scryer Prolog using a Dynamic Predicates model naturally representing entities and edges for complex deductive inference synced via external state changes on the EventBus.
* **CLI Interactivity & Data Management (`os_cli`)**:
  - **Create Entities**: `cargo run -p os_cli -- entity add <KIND> <LABEL>` (e.g., `entity add physical "Main Server"`)
  - **Read/Search Entities**: `cargo run -p os_cli -- entity ls` or `entity search "Server"`
  - **Update Metadata**: `cargo run -p os_cli -- entity update <ID_OR_LABEL> '{"key": "value"}'` (JSON block)
  - **Modify Tags**: `cargo run -p os_cli -- entity tag <ID_OR_LABEL> "critical"` or `entity untag <ID_OR_LABEL> "critical"`
  - **Delete Entities**: `cargo run -p os_cli -- entity rm <ID_OR_LABEL>`
  - **Relate Entities (Edges)**: `cargo run -p os_cli -- edge add <FROM> <TO> --label "connected_to"`
  - **Remove Relations**: `cargo run -p os_cli -- edge rm <FROM> <TO>`

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

### Phase 25: Scryer Prolog Module & Inference Engine
**Description**
Integrate a dynamic-predicate Scryer Prolog rules system into the Hexagonal Core to facilitate semantic edge discovery and topological inference natively on topological knowledge graph data.

**Tasks**
- [✓] Initialize the `ScryerMachine` in memory within an independent `prolog_engine` workspace crate.
- [✓] Implement the `StateSynchronizerTask` to map `EventBus` SurrealDB signals back into dynamically registered trait and relational Prolog predicates via gRPC or internal bus.
- [✓] Build the `InferenceEngine` interface allowing the Rust backend to asynchronously request deductions (`prolog_adapter.query(...)`).
- [✓] Provide mechanism to materialize resulting deductions back to `EventBus` as persistent semantic edges.

**Checks**
- [✓] Prolog machine initiates safely in the new crate (tested via standard cargo tests).
- [✓] Dynamic predicates and queries accurately unify strings during basic IO evaluations.

### Phase 26: Interfacing Prolog Engine via CLI and GUI Terminal
**Description**
Integrate the standalone `prolog_engine` deduction functionality outward to the user interfaces, enabling direct evaluation of semantic queries via headless CLI arguments and the embedded xterm.js GUI terminal.

**Tasks**
- [✓] Implement `prolog_engine` query handler interface within `os_cli` subcommands (e.g., `spatial-os prolog query "reachable(X, Y)."`).
- [✓] Expose an asynchronous Tauri IPC command (e.g. `invoke('run_prolog_query')`) routing strictly validated payload strings to the `InferenceEngine`.
- [✓] Connect the `xterm.js` integrated terminal ecosystem in `os_gui` to support querying Prolog facts natively via the `pl` command.
- [✓] Safely capture `run_query` output bindings to return human-readable parsed logs to the frontend terminal stdout stream.

**Checks**
- [✓] The CLI returns factual answers from the database correctly via the Inference rules engine.
- [✓] Firing a `pl` query through the inner GUI terminal displays formatted resulting bindings instantly without disrupting UI reactivity.

### Phase 27: GUI Terminal Expansion (SQL & Lifecycle)
**Description**
Expand the embedded GUI terminal toolset to gracefully handle native graph queries and application lifecycle management.

**Tasks**
- [✓] Add the `sql <STATEMENT>` terminal command to the React frontend.
- [✓] Connect `sql` logic through Tauri IPC to execute raw SurrealQL statements against `core_engine`.
- [✓] Add the `exit` command to safely and gracefully terminate the Tauri UI application.
- [✓] Update the `help` menu to expose both new commands to the user.
- [✓] Fix JSON Enum Serialization runtime panics in GUI and CLI by safely extracting the Surreal AST natively.

**Checks**
- [✓] The `sql` command resolves valid graph database outputs instantly to standard out.
- [✓] Typing `exit` fully and safely terminates the system process.

### Phase 28: CLI Data Management & Entity CRUD Hardening
**Description**
Harden the CLI entity management pipeline to support full CRUD operations, tag manipulation, and fix underlying database schema and serialization issues preventing field updates.

**Tasks**
- [✓] Add `tag` and `untag` CLI subcommands for entity tag manipulation.
- [✓] Fix `save_entity` to use `UPSERT` instead of `CREATE` so entity updates don't fail on existing records.
- [✓] Fix `get_entity` to cast IDs via `type::string(id)` to prevent SurrealDB Thing deserialization errors.
- [✓] Fix `tags` schema from `TYPE array` to `TYPE array<string>` with `OVERWRITE` to allow string tag persistence on SCHEMAFULL tables.
- [✓] Document CLI interactivity and data management in the Architecture section.

**Checks**
- [✓] All entity CRUD commands work: `entity add`, `entity ls`, `entity search`, `entity update`, `entity rm`.
- [✓] Tags persist correctly: `entity tag` adds, `entity untag` removes, duplicates are detected.
- [✓] Edges work: `edge add` links entities, `edge rm` removes links.
- [✓] `cargo check --workspace` passes with zero warnings.

### Phase 29: Unified Semantic Graph & Relational Tagging
**Description**
Refactor the legacy scalar tag model into a unified relational graph. Tags are transformed from static string arrays into independent `Abstract` entities linked via semantic edges, merging one-to-one and many-to-one relationships into a single architectural class.

**Tasks**
- [✓] Remove `tags` field from `Entity` model and SurrealDB schema.
- [✓] Modify `delete_edge` to support optional label-based filtering for precise relationship dismantling.
- [✓] Implement automatic `Abstract` entity creation during tagging operations in `os_cli`.
- [✓] Refactor `entity tag` and `entity untag` to manage `tagged_as` graph edges.
- [✓] Update `entity search` to traverse semantic edges for relational discovery.

**Checks**
- [✓] Tagging an entity creates a new `Abstract` node if the tag doesn't exist.
- [✓] Removing a tag destroys the edge but preserves the tag entity itself.
- [✓] Search results include entities linked via tag edges.
- [✓] System compiles with zero warnings after removing redundant `tags` property references.

### Phase 30: GUI Entity Management (CRUD, Tagging, Relations)
**Description**
Extend the GUI from read-only display into a fully interactive entity management interface. Users should be able to create, update, delete, tag, relate, and inspect entities without using the CLI.

**Tasks**
- [✓] Add 7 new Tauri IPC commands to `lib.rs`: `create_entity`, `update_metadata`, `delete_entity`, `tag_entity`, `untag_entity`, `remove_edge`, `get_entity_edges`.
- [✓] Update frontend `models.ts` — remove stale `tags: string[]` field (now graph edges).
- [✓] Expand Zustand `store.ts` with write actions and `selectedEntityEdges` state.
- [✓] Create `CreateEntityDialog` component (kind + label form, `Alt+N`).
- [✓] Create `RelateDialog` component (searchable entity picker + edge label).
- [✓] Refactor `ViewportPanel` Properties tab into an interactive `EntityInspector`: inline metadata editing, tag chips with add/remove, relationship list with remove.
- [✓] Enhance Registry tab: search bar, `[+ New]` button, context menu (select, tag, relate, delete).
- [✓] Add right-click context menu to `GraphPanel` nodes (inspect, tag, relate, delete).

**Checks**
- [✓] `entity add <kind> <label>` via GUI creates and selects the new entity.
- [✓] Metadata edits in the inspector persist after saving.
- [✓] Adding a tag in the inspector creates an `Abstract` entity + `tagged_as` edge.
- [✓] Removing a tag removes only the `tagged_as` edge; the tag entity survives.
- [✓] Creating a relationship via RelateDialog adds an edge visible in the graph.
- [✓] Removing a relationship from the inspector is reflected in the graph.
- [✓] Soft-deleting an entity removes it from all lists.
- [✓] `cargo check --workspace` and TypeScript build pass with zero errors/warnings.

### Phase 31: Tag-Based Visual Grouping (Hatched Regions)
**Description**
Enhance the `GraphPanel` to visualize semantic groups by drawing colored, hatched regions around nodes sharing the same tag. This clarifies the graph's high-level hierarchy while managing tag-entities as first-class citizens.

**Tasks**
- [✓] Implement `selectTagGroups` in `store.ts` to map tag-entities to member nodes.
- [✓] Add `showRegions` and node-filtering logic to `GraphPanel`.
- [✓] Implement `getConvexHull` and `createHatchPattern` utilities.
- [✓] Render hatched hulls and tag labels in `onRenderFramePre`.
- [✓] Add a "Regions" toggle to the Graph Panel toolbar.

**Checks**
- [✓] Tagged nodes are enclosed in hatched regions with the correct tag label.
- [✓] Tag nodes are hidden when region mode is active (unless other relationships exist).
- [✓] Hatching colors adapt to the active theme.

### Phase 32: Multi-Selection & Squared Mouse Selection
**Description**
Enable advanced node management through bulk operations (tagging, relating) and visual "Marquee" selection (drag-to-select). This significantly improves efficiency for large graph manipulation.

**Tasks**
- [✓] Extend `OsStore` to support a collection of selected entity IDs (`selectedIds`).
- [✓] Update `KEYBINDS` in `App.tsx` to include modifiers for multi-selection and marquee selection.
- [✓] Implement `Ctrl/Shift + Click` logic in `GraphPanel` for toggling single node selection.
- [✓] Implement "Selection Box" (Marquee) logic:
  - [✓] Add state for drag start/end coordinates.
  - [✓] Render a translucent colored rectangle during selection drag in `onRenderFramePre`.
  - [✓] Use `graph.getNodesPartiallyInArea(x1, y1, x2, y2)` or coordinate math to find nodes inside the box.
- [✓] Update Context Menu to detect "Selection Actions" (e.g., tag multiple nodes at once).
- [✓] Implement bulk tagging/relating logic in the store and backend (if needed).

**Checks**
- [✓] Dragging the background with `Shift` (or a toggle) draws a selection box.
- [✓] All nodes within the box are added to the selection state.
- [✓] Highlighting correctly shows all selected nodes.
- [✓] Context menu actions (Delete, Tag) apply to the entire selection.

### Phase 33: Entity Kind Filtering
**Description**
Implement a specialized graph filter that isolates specific entity kinds (physical, digital, abstract, agent, blob). The filter isolates the graph to show a strict inner subgraph: only nodes of the chosen kinds and the relationships where both endpoints belong to the selection.

**Tasks**
- [✓] Add `filterKinds: string[]` state to `OsStore` to manage multi-kind filtering.
- [✓] Create a `MultiKindFilter` control in the `GraphPanel` toolbar (allowing selection of all, some, or a single kind).
- [✓] Refactor the graph data update loop to implement "Strict Inner Subgraph" filtering:
    - Include only nodes matching the selected kinds.
    - Include only edges where both source and target nodes are in the selection.
- [✓] Update UI feedback (e.g., active filter chips or dropdown state).
- [✓] Ensure the physics simulation behaves predictably during subset transitions.

**Checks**
- [✓] Selecting one or more kinds (e.g., "Physical" + "Digital") shows only those nodes and edges between them.
- [✓] Selecting "All" (or clearing the filter) restores the full graph.
- [✓] The graph count badge reflects the strict filtered state (nodes and inner edges only).

### Phase 34: Temporal Kind & Timeline Panel
**Description**
Extend the data model with a `temporal` entity kind and a `TemporalTrait` supporting point events, span events, and recurring events. Build a `TimelinePanel` GUI component with a zoomable, scrollable timeline and a calendar tab. Selecting a temporal entity on the graph highlights it on the timeline (causal context tracking).

**Tasks**
- [✓] Add `Temporal` variant to `EntityKind` enum in `core_engine/src/models.rs`.
- [✓] Define `TemporalTrait` struct in `models.rs` (fields: `event_at`, `starts_at`, `ends_at`, `recurrence`).
- [✓] Add `save_temporal_trait` and `get_temporal_traits` to `GraphDatabase` port trait.
- [✓] Implement `temporal_trait` SurrealDB table schema and port methods in `db.rs`.
- [✓] Update entity kind schema assertion in `db.rs` to include `'temporal'`.
- [✓] Add `save_temporal_trait` and `get_temporal_traits` Tauri IPC commands in `src-tauri/src/lib.rs`.
- [✓] Add `"temporal"` to `EntityKind` and `TemporalTrait` interface in `models.ts`.
- [✓] Add `temporalTraits` state and `fetchTemporalTraits` action to `store.ts`.
- [✓] Add `temporal` color to `KIND_COLORS` in `GraphPanel.tsx`.
- [✓] Update `CreateEntityDialog.tsx` to include the `temporal` kind (coherent simple creation).
- [✓] Implement `TimelinePanel.tsx` with:
    - [✓] **Row-Packing Engine**: Implemented non-overlapping track-based row assignment for spans, points, and recurring events.
    - [✓] **Zoom-Adaptive Recurrence**: Dense recurring events (> 16px spacing) render as striped bands; sparse instances render as individual pins.
    - [✓] **Today Anchor**: Added a labeled vertical "Today" line that stays accurate across all zoom levels.
    - [✓] **Navigation Controls**: Added a "Reset" view button and an advanced year selector (±1/10/100/1000y jumps + direct input).
    - [✓] **Calendar Engine**: Fully functional month grid with event dots and day-level inspection.
- [✓] Standardize Tab Selector UI: Unified Timeline/Calendar tabs with ViewportPanel aesthetics.
- [✓] Fix Data Persistence: Resolved Tauri v2 camelCase serialization and SurrealDB `null` vs `NONE` schema violations for temporal fields.

**Checks**
- [✓] `cargo check --workspace` passes with zero warnings.
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] Creating a `temporal` entity via CLI succeeds without schema errors.
- [✓] Creating a `temporal` entity via the GUI "New Entity" dialog correctly attaches the temporal trait.
- [✓] Inspector shows temporal trait data when selecting a temporal node.
- [✓] Timeline label overlap fixed: labels auto-cull based on minimum pixel spacing.
- [✓] Point, span, and recurring events render accurately on the scrollable timeline.
- [✓] Selecting a temporal entity on the graph highlights it on the timeline.
- [✓] Calendar tab displays months and events with deep-time navigation support.
- [✓] Kind filter chips in `GraphPanel` include the `temporal` kind.

### Phase 35: Graph Traversal & Visualization
**Description**
Enhance the graph visualization to support interactive traversal and display of complex relationships.

**Tasks**
- [✓] **BFS Path Finder**: Implement a `findShortestPath(from, to, edges)` BFS utility in `graphUtils.ts` operating on the in-memory Zustand edge store (no backend round-trip needed).
- [✓] **Path Highlight State**: Add `highlightedPath: string[]` (node IDs) and `highlightedEdges: string[]` to the Zustand store, set when a path is found.
- [✓] **Path Visualization**: In `GraphPanel`, when a path is active, render path nodes with a reddish glow/outline and path edges with a thicker, colored stroke distinguishable from regular edges.
- [✓] **Path Finder UI**: Add a compact "Find Path" control to the `GraphPanel` toolbar using custom, theme-aware SearchableDropdowns with keyboard navigation.
- [✓] **Edge Label Filtering**: Add a filter control in the GraphPanel toolbar to show/hide edges by label (e.g. hide all `tagged_as` edges), alongside the existing kind filter.

**Checks**
- [✓] BFS correctly finds and highlights the shortest path between two selected nodes.
- [✓] Path edges are visually distinct from regular edges (color + width).
- [✓] Edge label filter hides/shows edges without disrupting the physics simulation.
- [✓] `npm run build` passes with zero TypeScript errors.

### Phase 36: Dynamic UI Layout & Panel Management (Suckless Extension)
**Description**
Extend the custom DWM React layout engine to support a dynamic "Stage & Widgets" system. Instead of integrating monolithic docking libraries, keep the core tiling mathematics and extend state management to allow independent floating, draggable panels and a rofi-like command palette via pure React portals.

**Tasks**
- [✓] **Decouple Pane State**: Refactor `App.tsx` state to split panels into two explicitly managed arrays: `tiledPanes` (managed by `TilingLayout`) and `floatingPanes` (managed by a higher z-index overlay plane).
- [✓] **Panel Detachment Mechanism**: Add an icon-based "Detach" toggle to the base `Pane` component, moving its ID from the tiling container to the floating container.
- [✓] **Floating Plane Manager**: Implement a minimal draggable window wrapper (using lightweight `react-rnd`) for components in the `floatingPanes` array, handling z-index focus tracking.
- [✓] **Command Palette Terminal (`rofi` style)**: Extract the `TerminalPanel` into a globally accessible, compact floating modal triggered by `Alt+T`. Terminal also remains available as a standard tiling panel.
- [✓] **Top Bar Refactoring & Theme Selector**: Consolidated the "Panels" toggle and replaced the long theme list with a dropdown selector.

**Checks**
- [✓] Base Master/Stack layouts remain fully functional.
- [✓] Specific panels can detach to the floating plane and be dragged/resized independently of the DWM blocks.
- [✓] The global terminal popup triggers instantly via `Alt+T` and Esc/exit/q close it correctly.
- [✓] The top bar is drastically decluttered, matching Suckless minimalism.

### Phase 37: Graph Selection Actions & Inspector Polish
**Description**
Improve keyboard productivity in the graph visualization and streamline bulk operations and tagging workflows in the properties inspector.

**Tasks**
- [✓] **Graph Keyboard Deletion**: Bind the `Delete` (Supr) key in the `GraphPanel` to safely delete the currently selected entities, accompanied by standard confirmation logic.
- [✓] **Bulk Deletion UI**: Add a prominent "Delete Selection" button in the `ViewportPanel` Properties tab when multiple entities are actively selected.
- [✓] **Tag Autocompletion**: Upgrade the custom tag addition field in the `EntityInspector` to utilize an autocompleting, theme-aware dropdown (like `SearchableDropdown`) to efficiently suggest existing abstract tag entities.
- [✓] **Graph Metrics Transparency**: Re-implement the Edge Count badge in the `GraphPanel` toolbar, positioning it next to the Node Count badge to provide live visibility into relationship density.

**Checks**
- [✓] Pressing `Delete` while nodes are selected successfully prompts and removes them.
- [✓] The Inspector displays a functional bulk-delete button during multi-selection.
- [✓] The tag field provides an accurate dropdown list of existing tags when typing.
- [✓] Both Node and Edge counts are visible in the toolbar and correctly reflect the strict inner subgraph filtering state.

### Phase 38: Spatial Entity Modification
**Description**
Expand the properties tab to allow comprehensive editing of spatial characteristics for spatial/physical entities, mirroring the temporal traits architecture.

**Tasks**
- [✓] Implement a **Spatial Trait Editor** interface within the `ViewportPanel` Properties tab.
- [✓] Allow users to directly input and modify geospatial data (e.g., coordinates, bounding boxes, or spatial references).
- [✓] Handle frontend state aggregation and ensure traits persist to the backend.
- [✓] Add support for bounding boxes and projections (WGS84 (EPSG:4326)).

**Checks**
- [✓] Spatial entities display an editable spatial/coordinate section in their properties.
- [✓] Changes made to spatial traits successfully save to the database.
- [✓] Projections are correctly displayed in the globe view.

### Phase 39: Enhanced Asset Rendering (PDF & Text)
**Description**
Refine the handling of document blob formats to improve legibility within the custom theme ecosystem and spatial integration inside the graph.

**Tasks**
- [✓] **Theme-Aware PDFs**: Implement CSS filter inversion or adjustments in the PDF viewer to ensure PDF documents adapt favorably to dark mode themes.
- [✓] **PDF Miniatures**: Extend the Graph node rendering loop to paint miniature preview icons for PDF blobs, creating visual parity with image nodes.
- [✓] **Text Visualization**: Add a native text rendering block/viewer tab inside the preview pane to easily visualize plain text file contents without requiring download.

**Checks**
- [✓] PDF documents change colors correctly according to dark/light theme dynamics.
- [✓] Nodes linked to PDFs render a recognizable miniature in the graph visualization.
- [✓] `.txt` and `.md` files render their plain contents actively in the viewport.

### Phase 40: Advanced Text Edition & External Editors
**Description**
Provide advanced, programmer-friendly configuration capabilities by treating node properties as raw text formats and seamlessly embedding external editors like Neovim.

**Tasks**
- [✓] **Data Export Editing**: Users can now trigger a "Edit in Terminal" mode that exposes entity properties as a structured text file (JSON, YAML, or Markdown).
- [✓] **Editor Integration**: Launch the system `$EDITOR` (e.g., Neovim) directly within the embedded terminal panel, bringing it to the front automatically.
- [✓] **Persistence Sync**: Implemented a robust "write-then-read" sync mechanism that captures editor save signals and parses modifications back into the SurrealDB context with real-time UI refreshes.
- [✓] **Shell Resilience**: Added auto-respawn logic for the main shell session and a manual "Refresh" button to recover from frozen terminal states.

**Checks**
- [✓] Neovim correctly loads entity data in the chosen format (YAML/Markdown).
- [✓] Terminating the editor session triggers an automatic data sync and returns the user to the system prompt.
- [✓] Modifications in the terminal text file are reflected immediately in the Graph and Properties panels.
- [✓] Terminal auto-focuses and elevates to the foreground when an editing session starts.
- [✓] "Open Externally" command opens files using the native system handler (via `opener`).

### Phase 41: Hybrid Globe Imagery & Local Fallback (10–20 GB)
**Description**
Implement a dual-layer imagery strategy: high-fidelity streaming via Google 3D Tiles and a robust, multi-gigabyte local fallback for offline/air-gapped operations.

**Tasks**
- [✓] **Local Tile Server**: Implement a lightweight MBTiles/TMS provider in `core_engine` (Rust) to serve the local imagery cache via loopback using `mmap` for zero-copy tile access.
- [✓] **Full Planet mbtiles**: Find a reasonably sized mbtiles file of the entire planet and add it to the local cache. Sources:
  - https://archive.org/download/osm-vector-mbtiles/
  - https://www.limaps.org/tileserver.html
- [✓] **Cesium Integration**: Configure `UrlTemplateImageryProvider` to target the local Rust server as the primary base layer.
- [✓] **Google 3D Tiles**: Integrate `createGooglePhotorealistic3DTileset`. Inject the API key via Tauri's secured state (`tauri::State`) to prevent frontend exposure.
- [✓] **Automatic Failover**: Implement network-status detection logic to automatically downgrade from Google 3D Tiles to the local cache when connectivity is severed.

**Checks**
- [✓] `cargo check --workspace` and `npm run build` pass with zero warnings/errors.

**Current Blockers**:
- [ ] **European Economic Area API restrictions**: Google Maps 3D tiles are not available in the EEA (https://developers.google.com/maps/comms/eea/map-tiles).
- [ ] **Imagery Persistence**: MBTiles path persistence is correctly reaching the backend, but `get_app_state` appears to hang or return empty for the user.
- [ ] **Online Resume**: Google Imagery does not automatically restore when toggling from Offline back to Online.

### Phase 42: Unified Polymorphic Geometry (`SpatialTrait`)
**Description**
Refactor the three fragmented spatial trait structs (`SpatialTrait` for points, `PathTrait` for lines, `RegionTrait` for polygons) into a single, unified `SpatialTrait` backed by a `Geometry` enum. The MIME-like geometry type drives all downstream rendering behavior in Cesium.

**Tasks**
- [✓] **Initial Multi-Trait Foundation**: Baseline support for points, paths, and polygons established using separate struct-per-geometry architecture.
- [ ] **`Geometry` Enum**: Define the following enum in `core_engine/src/models.rs`:
    ```rust
    pub enum Geometry {
        Point { lat: f64, lng: f64, alt: Option<f64> },
        LineString { points: Vec<Vec<f64>>, width: Option<f32>, color: Option<String> },
        Polygon { boundary: Vec<Vec<f64>>, height: Option<f64>, fill_color: Option<String> },
    }
    ```
- [ ] **Unified `SpatialTrait`**: Replace the separate `lat`, `lng`, `alt`, `points`, `boundary` fields in `SpatialTrait` with a single `geometry: Geometry` field. Remove the `PathTrait` and `RegionTrait` structs entirely from `models.rs`.
- [ ] **Database Schema Consolidation**: Update `db.rs` to collapse the `path_trait` and `region_trait` SurrealDB tables into a single `spatial_trait` table. Define the `geometry` column as a flexible SurrealDB `object` field.
- [ ] **Port Consolidation**: In `ports.rs`, remove the `save_path_trait` and `save_region_trait` methods from the `GraphDatabase` trait. All geometry is now persisted via `save_spatial_trait`.
- [ ] **GeoJSON Serialization**: Implement a `to_geojson_feature()` method on `SpatialTrait` that maps each `Geometry` variant to the correct GeoJSON `type` (`"Point"`, `"LineString"`, `"Polygon"`). This is the single trust boundary between the Rust model and the Cesium renderer.
- [ ] **Cesium Renderer Update**: Refactor `GlobePanel.tsx` to read a **unified geometry stream** and dispatch rendering (Cesium `PointPrimitive`, `Polyline`, `Polygon`) based on the GeoJSON `type` field in the feature, replacing the separate event handlers for paths and regions.
- [ ] **Interface Updates**:
    - [ ] Remove `pathTraits` and `regionTraits` from the Zustand store; merge all geometry into the `spatialTraits` map, keyed by entity ID.
    - [ ] Update `EntityInspector` in `ViewportPanel.tsx` to render geometry details dynamically based on the variant, without separate `pathTrait` and `regionTrait` prop branches.
    - [ ] Update `os_cli`'s `spatial add` command to accept a `--geometry` flag (values: `point`, `line`, `polygon`) instead of separate subcommands.

**Checks**
- [ ] The SurrealDB schema has a single `spatial_trait` table. `SHOW TABLES` returns no `path_trait` or `region_trait`.
- [ ] `cargo check --workspace` passes with zero warnings and zero references to the removed `PathTrait` and `RegionTrait` structs.
- [ ] A `Point`, a `LineString`, and a `Polygon` entity all render correctly on the Cesium globe simultaneously using the unified data stream.
- [ ] The Prolog engine still correctly resolves spatial predicates (e.g., `nearby/2`) after the schema change.

**Current Blockers**:
- [✓] **Prolog Sync**: Schema and model alignment verified; error was due to missing field in test data.

### Phase 43: Tile Server Extraction (Core → GUI)
**Description**
Remove the embedded HTTP tile server from `core_engine/src/tiles.rs` (which uses `axum` and opens a local TCP port) and replace it with a **Tauri Custom URI Scheme Protocol** handler in the GUI. The `.mbtiles` file path is registered as a `BlobTrait` entity in the knowledge graph, making the offline map a first-class trackable asset.

**Tasks**
- [ ] **Tauri Protocol Handler**: In `os_gui/src-tauri/src/lib.rs`, register a custom URI scheme `spatial-tiles://` using `tauri::Builder::register_uri_scheme_protocol`. The handler opens the `.mbtiles` SQLite file directly using `rusqlite` and returns tile bytes for a given `{z}/{x}/{y}` path.
- [ ] **TMS Y-coordinate Conversion**: Port the TMS Y-axis inversion logic (`y_tms = (1 << z) - 1 - y`) from `tiles.rs` into the new Tauri protocol handler.
- [ ] **MIME Type Detection**: Port the magic-byte MIME detection from `tiles.rs` into the handler so vector tiles (`application/vnd.mapbox-vector-tile`) and raster tiles (`image/png`, `image/webp`) are served with the correct `Content-Type`.
- [ ] **`BlobTrait` Registration**: When the user selects an `.mbtiles` file, record it as a `BlobTrait` entity in the graph with `mime: "application/x-mbtiles"` and the absolute filesystem path in `storage_id`. The GUI reads this trait at startup to find the current tile file.
- [ ] **Cesium URL Update**: Change the `UrlTemplateImageryProvider` URL in `GlobePanel.tsx` from `http://localhost:{PORT}/tiles/{z}/{x}/{y}` to `spatial-tiles://default/{z}/{x}/{y}`.
- [ ] **Core Cleanup**: Delete `core_engine/src/tiles.rs`. Remove `axum`, `tokio-rusqlite`, and all tile-serving dependencies from `core_engine/Cargo.toml`. Remove the `TileServer` startup call from the application bootstrap.

**Checks**
- [ ] The Cesium globe renders offline tiles correctly using the `spatial-tiles://` protocol with no HTTP server running.
- [ ] `lsof -i :{TILE_PORT}` confirms that no TCP port is opened by the application.
- [ ] `cargo check --workspace` passes with zero warnings and no reference to the removed `tiles.rs` module.
- [ ] The `.mbtiles` path is visible as a `BlobTrait` entity in the Entity Registry.
- [ ] Selecting a new `.mbtiles` file via the native file picker updates the `BlobTrait` and causes Cesium to reload the new tileset.


### Phase 44: Versioning & Temporal History (Event Sourcing)
**Description**
Transition the data model from a "current state" store to a "Git-like" versioned store. Every update to an entity or trait creates a new version, allowing for auditability and "time-travel" debugging of spatial/agent states.

**Tasks**
- [ ] **History Tables**: Redefine SurrealDB schema in `db.rs` to use separate history tables or `valid_from`/`valid_to` temporal indices for entities and traits.
- [ ] **Append-Only Engine**: Update `save_entity` and `save_trait` methods to treat updates as new insertions rather than overrides.
- [ ] **Snapshot Resolver**: Implement a `get_as_of(timestamp)` query capability in the `GraphDatabase` trait.
- [ ] **Timeline Sync**: Enable the `TimelinePanel` to act as a historical scrubber, updating the Graph and Globe views to match the selected historical moment.

**Checks**
- [ ] Updating a `SpatialTrait` twice leaves three records in the database (Creation + 2 updates).
- [ ] Querying "as of 10 minutes ago" returns the entity in its previous geographic position.

### Phase 45: Formal Ontology & Semantic Inferencing
**Description**
Upgrade relationship labels from simple strings to first-class semantic types. Implement rules for transitivity and inheritance so the system can "understand" that if a Document is *inside* a Folder, and the Folder *moves*, the Document moves too.

**Tasks**
- [ ] **Edge Schema**: Define a `RelationshipOntology` registry where labels (like `is_part_of`) are assigned properties (Transitive, Symmetric, etc.).
- [ ] **Trait Inheritance Engine**: Implement a resolver that allows child entities to functionally "inherit" traits (like `SpatialTrait`) from their parents across semantic edges.
- [ ] **Inference Service**: Link the `core_engine` to the `prolog_engine` for recursive relationship discovery (e.g., "Find all ancestors").

**Checks**
- [ ] A "File" node with no `SpatialTrait` accurately reports the coordinates of its "Server" parent node via the `is_hosted_on` edge.
- [ ] Proximity searches correctly identify inherited positions of sub-entities.

### Phase 46: Edge Traits (Smart Arrows)
**Description**
Implement "Smart Arrows" by utilizing SurrealDB's first-class relationship properties. Move data like "Connection Strength" or "Network Latency" from entity metadata directly onto the relationship edge.

**Tasks**
- [ ] **Schema Expansion**: Update `DEFINE TABLE edge` in `db.rs` to be `SCHEMAFULL` with typed fields (e.g., `strength: float`, `latency: int`, `metadata: object`).
- [ ] **Edge Model**: Define `EdgeProperties` in `models.rs` and update the `RELATE` syntax to use `SET content = $data`.
- [ ] **Unified Traversal**: Upgrade `GraphDatabase::get_edges` to return the full property record instead of just a string label.
- [ ] **GUI Edge Inspector**: Enable the `ViewportPanel` to inspect and edit an edge's properties when a connection is selected in the Graph view.

**Checks**
- [ ] Creating an edge with `strength = 0.9` persists accurately in SurrealDB.
- [ ] The `sql` terminal command effectively filters edges based on properties (e.g., `SELECT * FROM edge WHERE latency < 5ms`).

### Phase 47: Semantic Metadata Enforcement
**Description**
Harden the "flexible JSON" metadata bag by implementing Kind-specific schemas. This ensures that a `physical` entity *must* have certain fields while an `agent` requires others.

**Tasks**
- [ ] **Schema Registry**: Build a registration system in `core_engine` for `EntityKind` metadata requirements (using JSON Schema or similar).
- [ ] **Validation Middleware**: Add a validation step in `save_entity` that halts persistence if the provided metadata violates the Kind's schema.
- [ ] **GUI Form Generation**: Auto-generate property input fields in the `EntityInspector` based on the required schema for the entity's kind.

**Checks**
- [ ] Attempting to save a `physical` entity without a required `serial_number` metadata field fails with a descriptive error.
- [ ] The Inspector highlights missing but required fields in red.

### Phase 48: Universal Content Trait & Unified Logic Integration
**Description**
Consolidate all external content (Text, Markdown, YAML, Logic Rules, Blobs) into the unified `BlobTrait`. Instead of specialized traits, the system utilizes the `mime` field as the semantic discriminator. The `LogicTrait` is eliminated; logic rules are now stored as content-addressed blobs within the CAS.

**Tasks**
- [ ] **Trait Consolidation**: Remove `LogicTrait` and any "TextTrait" drafts. Update `BlobTrait` to ensure the `mime` type is strictly enforced as the primary metadata field.
- [ ] **Logic-as-a-Blob**: Refactor the `InferenceEngine` (Prolog) to fetch rules by subscribing to `BlobTrait` events where `mime == "application/x-prolog"`.
- [ ] **MIME-Driven Dispatch**: Implement a centralized `ContentDispatcher` in the GUI that automatically selects the correct viewer (Text Editor, Markdown Preview, 3D Renderer) based on the `BlobTrait` MIME type.
- [ ] **CAS Consistency**: Ensure that all text-based content (including logic) is stored in the CAS and referenced by its hash via the `BlobTrait`, bringing automatic deduplication and versioning to the system rules.

**Checks**
- [ ] Prolog rules stored in the CAS are successfully loaded and executed by the `prolog_engine`.
- [ ] The `PreviewPanel` correctly switches between a 3D view (for `.gltf`) and a Text Editor (for `.md` or `.pl`) using only the `BlobTrait` data.
- [ ] `cargo check --workspace` passes without any reference to the deprecated `LogicTrait`.

### Phase 49: Multilingual Ontology (`LabelTrait`)
**Description**
Implement a first-class multilingual naming system. Entities will support a canonical language representation while providing translated labels for any globally defined locale via the dedicated `LabelTrait`.

**Tasks**
- [ ] **Entity Schema Expansion**: Add a `canonical_lang` field (IETF BCP 47) to the `Entity` model and the SurrealDB `entity` table (e.g., defaults to `"en"`).
- [ ] **LabelTrait Implementation**: Define the `LabelTrait` struct (`owner`, `lang`, `text`) and its corresponding SurrealDB table.
- [ ] **Resolution Logic**: Implement the layered label resolver: (1) Active Locale Trait -> (2) Canonical Language Trait -> (3) Fallback `entity.label`.
- [ ] **Locale Management**: Integrated a global locale selector in the GUI and a `--lang` session flag in the CLI to toggle the active display language across the entire graph.

**Checks**
- [ ] An entity created with `canonical_lang: "de"` correctly displays its German label even if the UI is set to English (if no English `LabelTrait` exists).
- [ ] Adding a new `LabelTrait` for an existing entity instantly updates its display name in the Graph and Registry views.
- [ ] The CLI `entity ls` command respects the `--lang` flag when displaying labels.

### Phase 50: UI Utilities & UX Hardening
**Description**
Enhance the user experience with native integration for file management and quick identifier access.

**Tasks**
- [ ] **Native File Picker**: Implement native file explorer dialog integration (via Tauri's dialog API) to allow selecting single or multiple files for ingestion, replacing manual path entry in the GUI.
- [ ] **ULID Copy Tool**: Add a "Copy ULID" button to the `EntityInspector` and Registry list to quickly copy entity identifiers to the system clipboard.
- [ ] **Clipboard Feedback**: Integrate a brief "Copied!" tooltip or toast notification on successful clipboard write.

**Checks**
- [ ] The file picker successfully passes file paths to the `core_engine` ingestion pipeline.
- [ ] ULIDs are correctly copied and can be verified by pasting into any text field.
- [ ] `npm run build` passes with zero TypeScript errors.

### Phase 51: Contextual & Query-Based Data Loading
**Description**
Improve system performance and discovery by moving from "all-or-nothing" state loading to granular, context-aware hydration.

**Tasks**
- [ ] **Context Loading Engine**: Implement a backend capability to load the "context" of a given entity (fetching all neighbors and related nodes within a specific hop count).
- [ ] **Selective Hydration**: Update the Zustand store and SurrealDB queries to support loading specific subgraphs based on active exploration rather than full table scans.
- [ ] **Query-Based Filtering**: Add support for selective loading via complex queries (e.g., "Load all 'Physical' nodes related to 'Location X'") within the GUI.

**Checks**
- [ ] Requesting an entity's context correctly populates the graph with relevant relationships.
- [ ] Large databases do not stall the UI; only the queried subset is processed by the renderer.
- [ ] `cargo check --workspace` passes with zero warnings.

### Phase 52: Flexible Panel Architecture & Tab Merging
**Description**
Refactor the GUI from a fixed tabbed-viewport model to a fully flexible, recursive panel system. Every component (Entity Registry, Inspector, Asset Preview, Timeline, and Calendar) becomes an atomic standalone panel that can either tile, float, or be merged into another panel as a tab via interactive drag-and-drop.

**Tasks**
- [ ] **Atomic Component Extraction**: Decouple `EntityRegistry`, `EntityInspector`, `AssetPreview`, `Timeline`, and `Calendar` into independent top-level components, removing the rigid `ViewportPanel` and `TimelinePanel` containers.
- [ ] **Recursive Tab-Group State**: Update the Zustand layout store to support a recursive tree structure where any DWM tile can be either a "Single Component" or a "Tab Group" containing multiple components.
- [ ] **Drag-to-Merge Workflow**: Implement a header-based drag-and-drop interface where dragging a panel's title bar and dropping it onto another panel's header area merges them into a shared Tab Group.
- [ ] **Tiling/Tab Seamless Transition**: Ensure panels can be easily "detached" from a Tab Group back into a standalone tile or floating window.
- [ ] **Workspace Persistence**: Save and restore the entire recursive layout state (tiled, floating, and tabbed) across application restarts.

**Checks**
- [ ] Every component can be opened as a standalone tiling window by default.
- [ ] Dropping the `Timeline` panel onto the `Inspector` header correctly merges them into a tabbed interface.
- [ ] Resizing a Tab Group correctly scales all internal tabbed components.
- [ ] `npm run build` passes with zero TypeScript errors.

---

## Potential Future Phases

> The following phases are defined for directional reference. They are not yet scheduled and should be promoted to the main roadmap when their prerequisites are met.

### Phase 52 (Potential): Live OSINT Ingestion (ADSB, TLE, Maritime)
**Description**
Build background workers in the Rust `core_engine` to ingest live Open Source Intelligence (OSINT) feeds (aircraft, satellites, maritime vessels) and broadcast them via the `EventBus`.

**Tasks**
- [ ] **ADSB Worker**: Implement an async Tokio worker to poll ADSB-Exchange or OpenSky for live aircraft coordinates.
- [ ] **Satellite TLE Worker**: Integrate TLE propagation (via a Rust SGP4 crate) in the backend to compute live orbital positions from NORAD data.
- [ ] **EventBus Mapping**: Map incoming live signals to ephemeral `Entity` nodes with `SpatialTrait` and `TemporalTrait` and emit them on the `EventBus`.
- [ ] **Throttle Logic**: Implement spatial dead-reckoning to suppress IPC traffic for slowly-moving entities, reducing frontend update pressure.

**Checks**
- [ ] Live satellites and aircraft appear on the globe without manual refresh.
- [ ] The `os_cli` can query the live position of any tracked agent via `entity ls --kind agent`.
- [ ] Dead-reckoning correctly suppresses redundant updates (verified via EventBus message counters).
- [ ] `cargo check --workspace` passes with zero warnings.

### Phase 53 (Potential): Shader Intelligence (NVG, Thermal, CRT)
**Description**
Implement custom WebGL post-processing via Cesium's `PostProcessStageCollection` to emulate specialized sensor views: Night Vision Goggles (NVG), FLIR thermal, and a retro CRT aesthetic.

**Tasks**
- [ ] **NVG Stage**: Implement a fragment shader stage applying green-phosphor tint and procedural noise to simulate NVG optics.
- [ ] **Thermal Stage**: Implement a luminance-to-heatmap fragment shader (cool-to-warm palette) to simulate FLIR.
- [ ] **CRT Filter**: Add scanline and chromatic-aberration post-processing as a global Cesium post-process stage or CSS/shader overlay.
- [ ] **Uniform Control**: Wire shader parameters (gain, noise level, palette intensity) to the Properties Panel when the 3D Viewport is focused.
- [ ] **Mode Toggle**: Add a view-mode selector (Normal / NVG / Thermal / CRT) to the Globe panel toolbar.

**Checks**
- [ ] Toggle between Normal, NVG, Thermal, and CRT modes is instantaneous (no globe reload).
- [ ] Shaders correctly preserve transparency for UI overlays (labels, icons, billboards).
- [ ] `npm run build` passes with zero TypeScript errors.

### Phase 54 (Potential): 4D Causal Reconstruction
**Description**
Unify the Globe and Timeline for "God's Eye" historical playback — replaying any recorded event with all spatial actors (aircraft, ships, satellites) in their correct 3D positions, synchronized to the timeline scrubber.

**Tasks**
- [ ] **Record Mode**: Implement a Record mode that persists `EventBus` spatial updates into SurrealDB with sub-second temporal resolution (nanosecond `event_at` precision).
- [ ] **Cesium Clock Sync**: Link the `TimelinePanel` scrub action to the Cesium `Clock` API so all entity positions update in lock-step during playback.
- [ ] **Causal Highlighting**: When a node is selected on the `GraphPanel`, highlight the corresponding aircraft path and satellite overhead at the entity's exact timestamp on the globe.
- [ ] **Playback Controls**: Add play/pause/speed controls to the `TimelinePanel` for replay sessions.

**Checks**
- [ ] Replaying a historical event shows all moving entities (planes, ships, satellites) in their correct 3D positions synchronized to the timeline.
- [ ] Causal node selection correctly cross-links the Graph, Timeline, and Globe views simultaneously.
- [ ] Sub-second resolution is preserved through the SurrealDB → IPC → Cesium Clock pipeline.
- [ ] `cargo check --workspace` and `npm run build` pass with zero warnings/errors.

### Phase 55 (Potential): Agentic Geospatial Command
**Description**
Integrate the LLM/Prolog inference engines with the geospatial layer to enable natural language "vibe-coding" queries that resolve to visual spatial selections and automated globe camera control.

**Tasks**
- [ ] **NLP-to-Spatial Query**: Implement `agent find "<natural language>"` in `os_cli` and the GUI terminal (e.g., "satellites over Austin") translating to structured SurrealDB spatial-temporal queries.
- [ ] **Automatic Camera Control**: Allow the inference result to emit `camera_fly_to` Tauri IPC commands, flying the globe to the relevant area automatically.
- [ ] **Constraint-Based Search**: Expose complex Prolog constraint patterns (e.g., "Find all tankers that turned off AIS within 50km of a known strike") using the `prolog_engine` inference loop.
- [ ] **Cross-Panel Visual Resolution**: Resolved query results highlight matching entities on the `GraphPanel`, `TimelinePanel`, and Globe simultaneously.

**Checks**
- [ ] `agent find "satellites over Austin"` returns valid globe positions and flies the camera to the result.
- [ ] Complex OSINT Prolog queries resolve to visual selections across all three panels (Graph, Timeline, Globe).
- [ ] `cargo check --workspace` and `npm run build` pass with zero warnings/errors.

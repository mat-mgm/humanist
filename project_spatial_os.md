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

### Phase 35: Temporal Kind & Timeline Panel
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

### Phase 34: Graph Traversal & Visualization
**Description**
Enhance the graph visualization to support interactive traversal and display of complex relationships.

**Tasks**
- [ ] Implement graph traversal logic to find paths between nodes.
- [ ] Visualize paths in the 3D graph with distinct styling.
- [ ] Add support for different types of relationships (edges) with varying visual styles.
- [ ] Implement filtering based on edge types and node properties.

**Checks**
- [ ] Users can find paths between any two nodes in the graph.
- [ ] Different edge types are visually distinguishable.
- [ ] Graph filtering works as expected.

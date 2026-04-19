# Project Spatial OS

## Overview
A spatial operating system interface and backend.
* Purpose: A local-first, "Git for Data" Multimodal Intelligence Platform, managing nodes, edges, and blobs through generic, trait-based representations. It provides a unified environment to explore, interact with, and interconnect data, nodes, and spatial elements using a local database, PROLOG engine, and a window-managed GUI.
* Context: Built using a Rust backend internally structured with Hexagonal Architecture. It exposes functionality via a Tauri wrapper for the GUI and a CLI binary. The web-based frontend uses React, Vite, TypeScript, and Zustand. All environments are reproducible via NixOS `flake.nix`.
* Scope: Includes a CAS system, Prolog-based logic, a VS Code-style activity bar layout (default), a DWM-style tiling window manager (opt-in via Settings), a graph node viewer, a 3D globe viewer with causal timeline, an entity knowledge panel, and an integrated terminal.

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
  - **`core_engine` (Library)**: The embedded database logic using SurrealDB, an immutable local content-addressed blob store (with an S3-style adapter boundary preserved behind the blob port), background garbage collection (simulating `git gc`), and a unified Tokio `EventBus`. Exposes operations exclusively via traits like `GraphDatabase`.
  - **`os_cli` (Binary)**: Fast, headless terminal interface built with `clap` for automations and mass data ingestion.
  - **`prolog_engine` (Library)**: Dedicated standalone component executing the Scryer Prolog Inference Engine, interoperating with the Core EventBus.
  - **`os_gui` (Binary)**: Tauri 2.0 app with a Rust backend handling IPC commands. React frontend using atomic Zustand selectors for high-performance reactive UI updates, allowing 3D WebGL scenes to run isolated without stalling the main loop. Uses React Error Boundaries. Default shell is a VS Code-style activity bar layout (`ActivityBar` | resizable `SidePanel` | `PrimaryCanvas` | optional resizable right panel) with `lucide-react` icons throughout. The **CausalPanel** merges Globe, Timeline, and Calendar into a single resizable-split view. The **EntityKnowledgePanel** merges Entities and Relationships into a tabbed view. The DWM tiling layout (`TilingLayout` via `react-dnd`) is preserved and activatable via the Settings panel.
* Ontology & Traits: Uses client-generated ULIDs and soft deletes. Data is generic and augmented by traits (`Entity`, `Spatial Trait`, `Blob Trait`, `Temporal Trait`). `BlobTrait` is the canonical file-content attachment layer and carries externally accessible blob metadata such as `filename`, `mime`, `hash`, `size`, and content-addressed `storage_id`, rather than duplicating path information in generic entity metadata. Context entities emit semantic edges.
* **Entity Category**: Each entity has a `category` field (formerly `kind`) classifying its ontological nature. Four variants: `physical` (tangible objects), `digital` (software resources, files, datasets — ingested blobs receive this category), `abstract` (concepts, tags, ideas, events), `persona` (acting subjects: persons, processes, systems). Category is a pure ontological classifier orthogonal to trait composition — any entity of any category may carry any combination of traits. `BlobTrait` presence, not category, marks file-content entities; `TemporalTrait` presence, not category, marks time-anchored entities.
* **Temporal Causal Context Tracking**: Any entity can carry a `TemporalTrait` (supporting points, spans, and recurring events) regardless of its category. The **Timeline Panel** provides a synchronized visual representation, allowing for causal context tracking where selecting a node in any view highlights its temporal position.
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

### Phase 0: Template phase
**Description**
This phase is just an example to illustrate a the structure of a phase. Is not part of the real roadmap.

**Tasks**
- [] Task

**Checks**
- [] Check

**Design decisions** (optional)
- Decision:  
  Rationale:  
  Alternatives (optional):  
  Trade-offs (optional):

**Dependencies** (optional)

**Notes / Risks / Resources** (optional)
- Context, constraints, risks or auxiliar resources to support planning and execution.


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

### Phase 41: Versioning & Temporal History (Lightweight Shadow History)
**Description**
Add auditable version history to entities and traits using a dual-write shadow history strategy. The main write path (UPSERT) is preserved intact. On every write, a timestamped copy is appended to dedicated history tables. A `get_as_of(entity_id, timestamp)` resolver reconstructs the entity/trait state at any past moment. The `EntityInspector` gains a shallow "History" section listing versions; clicking one populates the inspector fields with that snapshot (no full graph/globe time-travel).

**Approach**: Lightweight Shadow History (Option B) — entities + all traits versioned (b) — Inspector-only shallow snapshot view.

**Tasks**

*Backend — Schema*
- [✓] **History Tables**: Define two new SurrealDB tables in `db.rs`:
  - `entity_history` — full copy of every entity write + `changed_at: datetime` + `entity_id: string`.
  - `trait_history` — unified shadow for all traits, with `trait_type: string` discriminator (`"spatial"`, `"temporal"`), `entity_id: string`, `changed_at: datetime`, and `data: object` holding the serialized trait payload.

*Backend — Dual-Write*
- [✓] **Entity Shadow Write**: After every successful `save_entity` UPSERT, insert the full entity struct into `entity_history` with `changed_at = time::now()`.
- [✓] **Trait Shadow Write**: After every successful `save_spatial_trait` / `save_temporal_trait` UPSERT, append one record to `trait_history` with the appropriate `trait_type` discriminator and full trait data in `data`.

*Backend — Query*
- [✓] **`get_entity_history(id)`**: Add to `GraphDatabase` port trait + `db.rs` implementation. Returns all `entity_history` records for a given entity ID, ordered by `changed_at` descending.
- [✓] **`get_as_of(id, timestamp)`**: Add to `GraphDatabase` port + `db.rs`. Returns the single `entity_history` record with the largest `changed_at ≤ timestamp` for the given entity.

*IPC Layer*
- [✓] **Tauri Commands**: Expose `get_entity_history` and `get_as_of` as Tauri IPC commands in `src-tauri/src/lib.rs`.

*Frontend — State*
- [✓] **Store**: Add `entityHistory: EntitySnapshot[]` and `fetchEntityHistory(id)` action to Zustand `store.ts`. Define `EntitySnapshot` type in `models.ts` (mirrors `Entity` + `changedAt: string`).

*Frontend — UI*
- [✓] **Inspector History Section**: Add a collapsible "History" section at the bottom of `EntityInspector` in `ViewportPanel.tsx`. Lists versions as `[timestamp] — label (kind)` rows. Clicking a row calls `get_as_of` and displays the snapshot fields in a read-only overlay within the inspector (clearly marked "Viewing snapshot — read only").

**Checks**
- [✓] After two updates to the same entity's label, `entity_history` contains 3 records for that ID (initial create + 2 updates).
- [✓] `get_as_of(id, T)` where T is between the first and second update returns the first updated label, not the latest.
- [✓] The Inspector "History" section lists all versions with correct timestamps.
- [✓] Clicking a snapshot row in the Inspector correctly populates the read-only snapshot view.
- [✓] `cargo check --workspace` passes with zero warnings.
- [✓] `npm run build` passes with zero TypeScript errors.

### Phase 42: Semantic Edges — Ontology, Payloads & Trait Inheritance
**Description**
Elevate edges from dumb labeled arrows into first-class semantic objects. Each edge label is backed by a `relationship_type` definition (carrying properties like `transitive`, `symmetric`, `inherits_traits`) stored in SurrealDB for runtime extensibility. Individual edge instances gain a typed payload (`strength`, `latency`, `metadata`). A Rust resolver uses the `inherits_traits` flag to walk parent edges and resolve inherited `SpatialTrait` values for entities that have none of their own.

**Tasks**

*Backend — Schema*
- [✓] **`relationship_type` table**: Define in `db.rs` with fields `label: string`, `transitive: bool`, `symmetric: bool`, `inherits_traits: bool`. Add a unique index on `label`.
- [✓] **`edge` payload fields**: Extend the existing `edge` table with `strength: option<float>`, `latency: option<int>`, `metadata: object FLEXIBLE`.

*Backend — Models & Port*
- [✓] **`RelationshipType` model**: Add to `models.rs`.
- [✓] **`EdgeRecord` model**: Replace the current `(String, String, String)` tuple with a proper struct (`from`, `to`, `label`, `strength`, `latency`, `metadata`) in `models.rs`.
- [✓] **Port methods**: Add to `GraphDatabase` — `save_relationship_type`, `list_relationship_types`, `delete_relationship_type`, `get_edges` updated to return `Vec<EdgeRecord>`.
- [✓] **Trait inheritance resolver**: Add `get_effective_spatial_trait(entity_id: &str) -> Result<Option<SpatialTrait>, String>` to `GraphDatabase`. Walks outgoing edges whose `relationship_type` has `inherits_traits = true`, up to 5 hops, returning the first ancestor `SpatialTrait` found.
- [✓] **Symmetric edge expansion**: `get_edges` expands symmetric relationship types at read time — a single stored edge with a symmetric label emits both directions without duplicate records.

*IPC Layer*
- [✓] **Tauri commands**: `save_relationship_type`, `list_relationship_types`, `delete_relationship_type`, `get_effective_spatial_trait`. Update `add_edge` / `get_edges` to pass edge payload fields.

*Frontend — State & Models*
- [✓] **Models**: Add `RelationshipType` and `EdgeRecord` interfaces to `models.ts`. Update `GraphEdge` in `store.ts` to use `EdgeRecord`.
- [✓] **Store**: Add `relationshipTypes: RelationshipType[]`, `fetchRelationshipTypes`, `saveRelationshipType`, `deleteRelationshipType` actions.

*Frontend — UI*
- [✓] **Relationship Type Manager**: Dedicated "Ontology" tab in `ViewportPanel` listing defined types, with a form to create new ones (label + toggles for `transitive`, `symmetric`, `inherits_traits`).
- [✓] **Edge Inspector**: In `ViewportPanel`, clicking a relationship row expands an inline payload section showing `strength`, `latency`, `metadata`.
- [✓] **Inherited trait display**: In the Inspector, if an entity has no `SpatialTrait`, `get_effective_spatial_trait` is called and coordinates are shown marked "Inherited from ancestor".

**Checks**
- [✓] A `relationship_type` record for `is_hosted_on` with `inherits_traits = true` persists in SurrealDB and appears in the type manager.
- [✓] A "File" entity with no `SpatialTrait` returns its "Server" parent's coordinates via `get_effective_spatial_trait` when connected by an `is_hosted_on` edge.
- [✓] Creating an edge with `strength = 0.9` persists correctly; `SELECT * FROM edge WHERE strength > 0.5` returns it via the SQL terminal.
- [✓] The Edge Inspector shows `strength`, `latency`, and `metadata` for a selected edge.
- [✓] A symmetric type (e.g. `is_connected_to`) causes A→B to appear as both directions in the graph; `SELECT * FROM edge` shows only one stored record.
- [✓] `cargo check --workspace` passes with zero warnings.
- [✓] `npm run build` passes with zero TypeScript errors.

### Phase 43: Multilingual Ontology (`LabelTrait`)
**Description**
Implement a first-class multilingual naming system. Entities will support a canonical language representation while providing translated labels for any globally defined locale via the dedicated `LabelTrait`.

**Tasks**
- [✓] **Entity Schema Expansion**: Add a `lang_canonical` field (IETF BCP 47) to the `Entity` model and the SurrealDB `entity` table (defaults to `"en"`).
- [✓] **LabelTrait Implementation**: Define the `LabelTrait` struct (`owner`, `lang`, `text`) and its corresponding SurrealDB table with unique index on `(owner, lang)`.
- [✓] **Resolution Logic**: Implement the layered label resolver: (1) Active Locale Trait -> (2) Canonical Language Trait -> (3) Fallback `entity.label`. Applied app-wide via `resolvedLabel()` pure helper in the store; drives GraphPanel nodes, DataTablePanel rows, and EntityInspector header.
- [✓] **Locale Management**: Language selector in the View menu (under Theme). `--lang` flag on `entity ls` in the CLI.

**Checks**
- [✓] An entity created with `lang_canonical: "de"` correctly displays its German label even if the UI is set to English (if no English `LabelTrait` exists).
- [✓] Adding a new `LabelTrait` for an existing entity instantly updates its display name in the Graph and Registry views.
- [✓] The CLI `entity ls` command respects the `--lang` flag when displaying labels.

### Phase 44: Contextual & Query-Based Data Loading
**Description**
Replace the "all-or-nothing" graph load with an Exploration Mode: the graph starts empty and is built incrementally by selecting entities. A backend N-hop BFS resolver hydrates the neighborhood of any entity; a multilingual explore bar drives discovery. Full-graph load remains available as an escape hatch.

**Approach**: Exploration/Expand Mode — graph starts blank; selecting or searching an entity merges its N-hop neighborhood into the visible graph. Default mode is context; "Load Full" and "Clear" buttons provide escape hatches. Hop count is configurable via a toolbar spinner (0–5, default 2). The explore bar does multilingual label search by default; inputs starting with `SELECT` are executed as raw SurrealQL and load exactly the returned entities (no BFS expansion).

*Backend — Port & Implementation*
- [✓] **`get_entity_neighborhood`**: Add to `GraphDatabase` port + `db.rs`. Iterative BFS in Rust: each hop uses SurrealDB's native graph syntax (`->edge->entity` and `<-edge<-entity`). Returns `(Vec<Entity>, Vec<EdgeRecord>)` — both the N-hop cloud of entities and the edges connecting only those entities.
- [✓] **`search_entities_by_label`**: Add to `GraphDatabase` port + `db.rs`. Queries `entity.label` (CONTAINS) and `label_trait.text` (CONTAINS, optional `lang` filter). Returns active (non-deleted) entities only.
- [✓] **Fix/deprecate `query_context`**: The existing implementation is broken (references non-existent `from_id`/`to_id` columns post Phase 18). Replace calls with `get_entity_neighborhood`.
- [✓] **`query_entity_ids`**: Add to `db.rs`. Wraps any user SurrealQL as a subquery, strips trailing semicolons, returns only `entity:`-prefixed IDs.

*IPC Layer*
- [✓] **Tauri commands**: `get_entity_neighborhood(entity_id: String, hops: u8)`, `search_entities(query: String, lang: Option<String>)`, and `query_entity_ids(query: String)`.
- [✓] **`backend-ready` event**: emitted from Rust after `app.manage()` completes so the frontend can gate actions on confirmed backend availability.

*Frontend — Store*
- [✓] **New state**: `graphMode: 'context' | 'full'` (default `'context'`), `hopCount: number` (default `2`).
- [✓] **`expandContext(entityId)`**: Calls `get_entity_neighborhood`, merges (deduplicates by ID) into `entities` and `edges`. Does not clear existing graph state.
- [✓] **`loadExactIds(ids)`**: Fetches only the specified entity IDs and the edges between them — no BFS expansion. Used by SQL queries to load precisely what the query returns.
- [✓] **`clearGraph()`**: Resets `entities: []`, `edges: []`.
- [✓] **`loadFullGraph()`**: Calls `list_entities` + `get_edges` directly, sets `graphMode: 'full'`. Does not pre-clear entities to avoid triggering a mid-simulation empty state in ForceGraph2D.
- [✓] **`setHopCount(n)`**: Updates `hopCount`. Minimum is 0 (entity itself only, no neighbors).
- [✓] **`selectEntity` auto-expand**: In context mode, `selectEntity` also triggers `expandContext` for the selected ID.
- [✓] **`App.tsx` startup**: Remove `fetchEntities()` and `fetchEdges()` bootstrap calls; graph starts empty.
- [✓] **`allEntities`**: Full entity list kept in sync for instant local filtering in the explore dropdown (refreshed on every `entity-updated` event and on startup).
- [✓] **`backendReady`**: Boolean flag; set to `true` by `fetchAllEntities` on first successful IPC call. Gates the Load Full button.

*Frontend — GraphPanel UI*
- [✓] **Explore bar — all-entities dropdown**: On focus (even with empty input) lists all entities from `allEntities`, filtered locally by label, kind, or `LabelTrait` text. No backend round-trip required.
- [✓] **Explore bar — kind search**: Typing a kind name (e.g. `physical`, `abstract`) filters the dropdown to entities of that kind.
- [✓] **Explore bar — SQL passthrough**: Input starting with `SELECT` is debounced and executed via `query_entity_ids`; results are loaded with `loadExactIds` (hop count ignored).
- [✓] **Explore bar — status feedback**: Brief status message (e.g. "3 entities loaded", "No entities found") shown inline after SQL execution.
- [✓] **"Clear" button**: calls `clearGraph()`.
- [✓] **"Load Full" button**: disabled and labelled "Init…" until `backendReady` is true; calls `loadFullGraph()` once active.
- [✓] **Hops spinner**: integer input 0–5, updates `hopCount`. 0 = load the entity itself with no neighbors.
- [✓] **Empty-state overlay**: when `entities.length === 0` in context mode, render a centered hint over the graph canvas: *"Search or select an entity to explore"*.

*Data*
- [✓] **Seed script** (`test/seed_db.sh`): populates the DB with 14 entities, 4 spatial traits, 2 temporal traits, 25 label traits (de/fr/pt), 8 relationship types, and 18 edges for representative test data.

**Checks**
- [✓] Graph starts empty on launch (no full table scan at boot).
- [✓] Searching a label in the explore bar returns a dropdown of matching entities (respecting active locale).
- [✓] Clicking the explore bar with no text shows all entities in the dropdown.
- [✓] Typing a kind name (e.g. `physical`) filters the dropdown to entities of that kind.
- [✓] Selecting a search result populates the graph with the entity and its N-hop neighborhood.
- [✓] Clicking a node already in the graph expands its context (merges new neighbors without clearing existing nodes).
- [✓] The hops spinner correctly controls neighborhood depth (0 hops = entity only, no neighbors).
- [✓] "Clear" resets the graph to empty; "Load Full" loads all entities and edges.
- [✓] A `SELECT`-prefixed query loads exactly the returned entities — hop count is ignored, no BFS expansion.
- [✓] "Load Full" button is disabled with label "Init…" until the backend signals readiness.
- [ ] "Load Full" on first launch no longer crashes the Knowledge Graph panel. *(regression: ForceGraph2D simulation callback fires on stale node reference during the first load; subsequent loads work correctly)*
- [✓] `cargo check --workspace` passes with zero warnings.
- [✓] `npm run build` passes with zero TypeScript errors.

**Known Issues**
- **Load Full first-launch crash**: Clicking "Load Full" immediately after launch crashes the Knowledge Graph panel with "The object can not be found here." Clicking the ErrorBoundary retry button recovers and all subsequent loads work correctly. Root cause is suspected to be a ForceGraph2D d3 simulation callback referencing a node that no longer exists during the first state transition. Mitigations attempted: `block_on` in Rust setup, frontend retry loop, `backend-ready` event gating, removing the pre-clear step in `loadFullGraph`. None fully resolved the issue on first launch.

### Phase 45: Flexible Panel Architecture & Tab Merging
**Description**
Refactor the GUI from a fixed tabbed-viewport model to a fully flexible panel system. Every component becomes an atomic standalone panel that can tile, float, or be merged into another panel as a tab via interactive drag-and-drop.

**Design Decisions**
- **9 atomic panels**: Graph, Globe, Terminal, Properties (EntityInspector), Preview (AssetPreview), Entities (EntityRegistry), Relationships (OntologyPanel), TimelineView, CalendarView
- **Drag-to-merge**: `react-dnd` + `react-dnd-html5-backend`; drag item carries `{ id, fromSlotIdx }` to distinguish merge-from-outside vs reorder-within
- **Layout state**: Minimal tree — `SlotNode = { type: 'pane'; id: string } | { type: 'tabgroup'; ids: string[]; active: string }`. `tiledPaneIds: string[]` → `tiledSlots: SlotNode[]`. Existing `LayoutMode` presets preserved.
- **Persistence**: `localStorage` key `spatial-os:layout` (serializes `tiledSlots`, `floatingPaneIds`, `layoutMode`)
- **Default layout**: `[pane:graph, tabgroup:[inspector, registry, preview, ontology]]` — Globe, Timeline, Calendar, Terminal off by default
- **Panel reordering**: `Alt+Enter` promotes focused tiled slot to index 0; `Alt+j` / `Alt+k` are context-sensitive — cycle tabs within a focused tabgroup (stopping at the boundary and moving to the adjacent slot rather than wrapping)
- **Panel renames**: Inspector → Properties, Asset Preview → Preview, Entity Registry → Entities, Ontology → Relationships

**Tasks**

*Atomic Extraction*
- [✓] Extract `EntityInspector` → `components/EntityInspector.tsx`
- [✓] Extract `AssetPreview` → `components/AssetPreview.tsx`
- [✓] Extract `EntityRegistry` → `components/EntityRegistry.tsx`
- [✓] Extract `OntologyPanel` → `components/OntologyPanel.tsx`
- [✓] Extract `TimelineView` (timeline tab) → `components/TimelineView.tsx`
- [✓] Extract `CalendarView` (calendar tab) → `components/CalendarView.tsx`
- [✓] Delete `ViewportPanel.tsx` and `TimelinePanel.tsx`

*Layout State Refactoring*
- [✓] Define `SlotNode` type; replace `tiledPaneIds` with `tiledSlots: SlotNode[]` in `App.tsx`
- [✓] Update `ALL_PANES` to include all 9 atomic panels
- [✓] Update `TilingLayout` to accept and render `SlotNode[]` instead of `PaneConfig[]`

*Tab Group UI*
- [✓] Implement `TabGroupPane` sub-component in `TilingLayout.tsx`: tab bar + active pane body
- [✓] Each tab chip has an `×` close button (removes from group; collapses single-child groups to plain `pane`)
- [✓] Each tab chip has a `↗` detach button (removes from group; inserts as new tiled slot or floating)

*Drag-to-Merge*
- [✓] Install `react-dnd` + `react-dnd-html5-backend`
- [✓] Wrap `<App>` in `DndProvider`
- [✓] Pane headers and tab chips are drag sources (`type: 'PANEL'`, payload: `{ id, fromSlotIdx }`)
- [✓] Pane headers and tab bar are drop targets: dropping merges dragged panel into the target's tab group (creates one if needed)
- [✓] Visual highlight on valid drop target during hover
- [✓] Tab chips are also drop targets for reordering within the same tabgroup (`canDrop` checks `fromSlotIdx === slotIdx`)

*Reordering*
- [✓] `Alt+Enter`: promote focused tiled slot to index 0
- [✓] `Alt+j` / `Alt+k`: context-sensitive tab/slot navigation — cycle tabs within tabgroup, escape to adjacent slot at boundary

*Floating → Tab Attachment*
- [✓] Floating panel header has `⊕` button revealing a slot picker dropdown
- [✓] Selecting a slot from the picker calls `onMergeInto`, removing the panel from the floating layer and merging it into that slot as a tab

*Workspace Persistence*
- [✓] Serialize `{ tiledSlots, floatingPaneIds, layoutMode }` to `localStorage` on every mutation
- [✓] Restore on startup; fall back to default on parse error

**Checks**
- [✓] Every panel can be opened as a standalone tiling window
- [✓] Dragging `Timeline` onto `Inspector`'s header merges them into a shared tab group
- [✓] Resizing a TabGroup slot correctly scales all internal panels
- [✓] Detaching a tab from a TabGroup works (both to tiled and floating)
- [✓] `Alt+Enter` promotes focused slot to master
- [✓] `Alt+j` / `Alt+k` cycle tabs in a focused tab group and escape at boundary to the adjacent slot
- [✓] Tabs within a tabgroup can be reordered by dragging one chip onto another
- [✓] Floating panel can be attached as a tab into any existing tiled slot via the `⊕` slot picker
- [✓] Layout state survives an app restart (localStorage)
- [✓] `npm run build` passes with zero TypeScript errors

### Phase 46: Activity Bar Layout, Side Panel & Lucide Icons
**Description**
Redesigned the application shell from a top-menu DWM interface to a VS Code-style activity bar layout. A 48 px left rail (`ActivityBar`) holds three primary canvas buttons (Knowledge Graph, Causal, Terminal) and a Settings button at the bottom. Clicking the active icon collapses/expands the left side panel (VS Code behavior). The remaining width is the primary canvas. An optional resizable right panel with a panel picker can be opened via `Ctrl+\`. The left side panel is also user-resizable. Globe, Timeline, and Calendar are merged into a single **CausalPanel** (resizable split; Globe top, Timeline/Calendar tabbed bottom). Entities and Relationships are merged into a **EntityKnowledgePanel** (tabbed, scrollable). All emoji replaced with `lucide-react` icons. The DWM tiling layout is preserved and opt-in via Settings.

**Design Decisions**
- **Activity bar**: Three primary canvas entries — Graph (`Search`), Causal (`Globe`), Terminal (`Terminal`) — plus Settings at bottom. No separate tool-panel buttons in the rail; all auxiliary panels are accessed via the right panel picker.
- **Side panel**: Collapsible, user-resizable (160–600 px, default 280 px). Content is context-sensitive: Graph → GraphSidePanel; Causal → companion hint; Settings → SettingsPanel (theme, locale, Tiling Mode toggle). Clicking the active icon again toggles it.
- **CausalPanel**: Globe (lazy, top section) + 4 px drag handle + tab bar (Timeline / Calendar) + bottom section. Top height is user-adjustable (15–85 % of container). Code modules (GlobePanel, TimelineView, CalendarView) remain separate.
- **EntityKnowledgePanel**: Tabs (Entities / Relationships) with compact accent-button style matching CausalPanel's tab bar; scrollable body.
- **Right panel**: Resizable (160–700 px, default 300 px). A panel picker icon bar allows selecting any panel except those already in the primary canvas. When Causal is the primary canvas, Globe/Timeline/Calendar are all excluded from the picker (they are subsumed by CausalPanel); otherwise only the active canvas panel is excluded.
- **Primary canvas isolation**: Clicking Settings or any future tool entry does not alter `primaryCanvasId`; only graph/causal/terminal clicks update it.
- **Tiling WM**: DWM layout accessible via "Tiling Mode" toggle in Settings side panel; "Exit Tiling Mode" button in tiling menubar. Enabling restores previous tiled workspace from `localStorage`.
- **Icon set**: `lucide-react`; mapping below.

**Activity Bar Icon Mapping**

| Position | Activity | Lucide Icon |
|----------|----------|-------------|
| Top | Knowledge Graph (canvas) | `Search` |
| Top | Causal Panel (canvas) | `Globe` |
| Top | Terminal (canvas) | `Terminal` |
| Bottom | Settings | `Settings` |

**Right Panel Picker Icon Mapping**

| Panel | Lucide Icon |
|-------|-------------|
| Graph | `Search` |
| Globe | `Globe` |
| Timeline | `Clock` |
| Calendar | `Calendar` |
| Terminal | `Terminal` |
| Entity Inspector | `Info` |
| Entity Registry | `Database` |
| Asset Preview | `Eye` |

**Tasks**

*Dependencies*
- [✓] Add `lucide-react` to `os_gui` npm dependencies.

*Icon Migration*
- [✓] Replace emoji and text-based icons app-wide with `lucide-react` components.

*Shell Layout Refactor*
- [✓] Create `components/ActivityBar.tsx`: 48 px left rail; primary canvas icons top; Settings icon bottom; active icon highlighted; click-to-toggle side panel.
- [✓] Create `components/SidePanel.tsx`: collapsible, user-resizable panel (default 280 px). Context-sensitive content per active activity.
- [✓] Inline right panel in `App.tsx`: user-resizable, with panel picker; hidden by default.
- [✓] Refactor `App.tsx` shell: `ActivityBar | SidePanel | PrimaryCanvas | RightPanel` flex layout as default.
- [✓] Move graph toolbar controls into `GraphSidePanel.tsx`; rendered in side panel when Graph is active.
- [✓] Create `components/CausalPanel.tsx`: Globe (top) + resizable drag handle + Timeline/Calendar tabs (bottom).
- [✓] Create `components/EntityKnowledgePanel.tsx`: Entities / Relationships tabs with scrollable body.

*Right Panel*
- [✓] Bind `Ctrl+\` to toggle the right panel open/closed.
- [ ] Drag-and-drop from activity bar icon to right edge to open panel in right slot. *(not implemented)*

*Store Updates*
- [✓] Add to Zustand store: `activeActivity`, `sidePanelOpen`, `rightPanelId`, `tilingModeEnabled`.

*Keyboard Shortcuts*
- [✓] `Ctrl+G` → switch to Graph canvas.
- [✓] `Ctrl+B` → toggle side panel.
- [✓] `Ctrl+\` → toggle right panel.

*Settings Side Panel*
- [✓] Settings activity renders: theme selector, locale selector, Tiling Mode toggle.
- [✓] Tiling Mode toggle re-enables DWM layout and hides activity bar; "Exit Tiling Mode" in tiling menubar returns to activity bar.

**Checks**
- [✓] Activity bar renders with correct Lucide icons; active icon is visually highlighted.
- [✓] Clicking a primary canvas icon (Graph, Causal, Terminal) switches the primary canvas.
- [✓] Clicking the active icon again collapses the side panel; clicking it once more re-opens it.
- [✓] Clicking Settings does not switch the primary canvas.
- [✓] Right panel opens/closes via `Ctrl+\`; panel picker selects the displayed panel.
- [✓] Right panel and side panel are both user-resizable by dragging their inner edge.
- [✓] CausalPanel split between Globe and Timeline/Calendar is movable by dragging the handle.
- [✓] EntityKnowledgePanel Entities/Relationships tabs scroll when content overflows.
- [✓] Settings side panel exposes theme selector, locale selector, and Tiling Mode toggle.
- [✓] Enabling Tiling Mode from Settings switches to the DWM layout; "Exit Tiling Mode" restores activity bar.
- [✓] No emoji characters remain in any panel component.
- [✓] `npm run build` passes with zero TypeScript errors.

### Phase 47: Proper Local Content-Addressed Blob Store
**Description**
Refactor the current local blob storage into a true immutable content-addressed store. All externally accessible content files, including Markdown notes and Prolog source files, are stored as local plain files under deterministic hash-derived paths. The database remains the semantic index and points to the active blob via `BlobTrait`, but blob content itself is no longer mutated in place.

**Tasks**
- [✓] **Real Hash Addressing**: Replace ULID-based blob paths with deterministic content-hash-based `storage_id` values and store the real digest in `BlobTrait.hash`.
- [✓] **Immutable Local CAS**: Refactor `LocalBlobAdapter` so writes are content-addressed and idempotent. If content already exists for a hash, reuse it instead of duplicating it.
- [✓] **External File Accessibility**: Ensure local blobs remain directly accessible as plain filesystem files so external editors and tools can open them without any projection layer.
- [✓] **Blob Update by Replacement**: Replace in-place blob mutation with “write new blob, update `BlobTrait` pointer” semantics for edited text content.
- [✓] **Canonical Text-as-Blob**: Make Markdown, Prolog, and other text content canonical in the blob store via `BlobTrait`, rather than duplicating file paths or note bodies in generic entity metadata.
- [✓] **Reference-Safe GC**: Update garbage collection so only blobs no longer referenced by any live entity/trait are eligible for removal.

**Checks**
- [✓] Ingesting the same file content twice results in one reused blob object with the same content hash.
- [✓] Editing a Markdown note creates a new blob path/hash while preserving the old blob as historical content.
- [✓] A stored Markdown or Prolog blob can be opened directly from its local filesystem path by an external tool.
- [✓] `cargo check --workspace` passes after the CAS refactor.

**Design decisions**
- Decision: Use direct local CAS files with no workspace/projection layer.  
  Rationale: Keeps the system minimal, externally accessible, immutable, and free of duplicate editable mirrors.  
  Alternatives: Stable workspace projection or DB-canonical text fields.  
  Trade-offs: External paths are hash-based and therefore not stable across content edits.

**Notes / Risks / Resources**
- Prolog loading behavior is intentionally out of scope for this phase and should be handled in a later phase once CAS semantics are stable.
- `BlobTrait.mime` remains the dispatch key for viewers and processors, but MIME dispatch should build on top of the new CAS substrate rather than define it.
- New blobs do not write `import_path` or `source_path` into generic entity metadata; CLI and GUI resolve file access through `BlobTrait` fields instead.

### Phase 48: Ontological Model Refactor — Category, Persona, and Trait Separation
**Description**
Rename the `kind` field to `category` across the entire stack (Rust models, SurrealDB schema, Tauri IPC, TypeScript interfaces, and all frontend components) to better express its ontological role. Simultaneously rename the `Agent` variant to `Persona`. Remove the `Blob` and `Temporal` variants from `EntityKind`: both were redundant with `BlobTrait` and `TemporalTrait`, which are orthogonal capability layers any entity can carry regardless of category. `EntityKind` is reduced to four pure ontological classifiers: `Physical`, `Digital`, `Abstract`, `Persona`. Fix resulting graph rendering and data-loading bugs introduced by the schema migration.

**Tasks**
- [✓] **Rust models**: Rename `Entity.kind` → `Entity.category` and `EntitySnapshot.kind` → `EntitySnapshot.category` in `core_engine/src/models.rs`.
- [✓] **Enum variant**: Rename `EntityKind::Agent` → `EntityKind::Persona`; update `#[serde(rename_all = "lowercase")]` serialization.
- [✓] **Remove Blob/Temporal variants**: Drop `EntityKind::Blob` and `EntityKind::Temporal`; add `#[serde(alias = "kind")]` to `Entity.category` for backward-compat deserialization of legacy DB records.
- [✓] **SurrealDB schema**: Update `DEFINE FIELD category` allow-list to `['physical', 'digital', 'abstract', 'persona']` in `core_engine/src/db.rs`; remove `blob` and `temporal` entries.
- [✓] **Tauri IPC**: Rename `create_entity(kind)` → `create_entity(category)`; remap blob ingest to `EntityKind::Digital`; remap tag creation to `EntityKind::Abstract`; normalize raw SQL result JSON (`"kind"` key → `"category"`) in `list_entities` for backward compat with pre-migration DB records.
- [✓] **CLI**: Rename `EntitySub::Add { kind }` → `EntitySub::Add { category }`; remove `"temporal"` arm; update `blob ls` to filter by `BlobTrait` presence instead of category.
- [✓] **TypeScript models**: Update `EntityKind` union to `"physical" | "digital" | "abstract" | "persona"` and rename `.kind` → `.category` in `models.ts`.
- [✓] **Frontend store**: Update `invoke('create_entity', { category })` in `store.ts`.
- [✓] **Components**: Replace all `.kind` → `.category` accesses; update `KIND_COLORS` and `ENTITY_KINDS` to 4 variants; remove `blob` and `temporal` options from `CreateEntityDialog`; remove `.kind-blob` CSS rule; rename `.kind-agent` → `.kind-persona`.
- [✓] **UI label**: Update "Kind:" → "Category:" in the EntityInspector history snapshot view.
- [✓] **Seed script**: Update `test/seed_db.sh` — all `kind:` → `category:`, `'agent'` → `'persona'`, `exhibition_2024` and `meeting_q2` changed from `category: 'temporal'` to `category: 'abstract'`.

**Checks**
- [✓] No `EntityKind::Agent`, `EntityKind::Blob`, `EntityKind::Temporal`, `.kind`, or `"agent"` references remain in any `.rs`, `.ts`, or `.tsx` file.
- [✓] `cargo check` passes with zero warnings on `core_engine`, `os_cli`, `prolog_engine`.
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] Graph nodes render with correct category colours after migration (gray-node regression fixed via JSON normalization in `list_entities`).
- [✓] "Load Full" button works after migration (raw-SQL path + normalization avoids typed deserialization failure on pre-migration records).

**Design decisions**
- Decision: Rename `kind` → `category` rather than `type`.  
  Rationale: `type` is a reserved keyword in both Rust (`r#type`) and TypeScript, and collides with SurrealDB's `TYPE` schema keyword.
- Decision: Rename `Agent` → `Persona`.  
  Rationale: `Persona` more accurately denotes an acting subject (person, process, system with agency) without implying automated software agent semantics.
- Decision: Remove `Blob` and `Temporal` from `EntityKind`.  
  Rationale: `category` answers "what is this thing ontologically"; `BlobTrait` and `TemporalTrait` answer "what data does it carry". A physical place can be temporal (an event); a digital resource can carry a blob attachment. Conflating capability with identity produced contradictions (a blob is also digital/abstract/etc.). Traits are the correct abstraction layer for cross-cutting capabilities.

### Phase 49: Structured Logging Standard
**Description**
Establish a consistent, minimal logging system across all Rust crates and the Tauri IPC layer.
All modules emit events through the `tracing` facade. A single initializer in `core_engine` wires
up dual output: human-readable colored stdout and a rotating JSON-lines log file under the
platform app-log directory. Logs are boundary-scoped: one line per subsystem startup and one line
per key operation (blob store, GC, DB connect). Nothing fires inside loops or on every IPC call.

**Tasks**

*Dependencies*
- [✓] Add `tracing`, `tracing-subscriber` (features: `env-filter`, `fmt`, `json`) to `core_engine/Cargo.toml`.
- [✓] Add `tracing-appender` to `core_engine/Cargo.toml` for rolling file output.
- [✓] Add `tracing` (facade only, no subscriber) to `prolog_engine/Cargo.toml` and `os_cli/Cargo.toml`.

*Core Initializer*
- [✓] Define `LogConfig { level: LevelFilter, log_dir: Option<PathBuf> }` in `core_engine/src/logging.rs`.
- [✓] Implement `logging::init(config: LogConfig)` — sets up a `tracing-subscriber` registry with:
  - Fmt layer (stdout, ANSI color, compact format).
  - Optional daily-rolling JSON-lines file layer via `tracing-appender` (keep last 7 files).
  - `EnvFilter` seeded from `RUST_LOG`, falling back to `config.level`.
- [✓] Store the `tracing-appender` non-blocking guard in a `static` or return it from `init` so it is held for the process lifetime (dropping it silently stops file writes).
- [✓] Call `logging::init` exactly once: from `os_cli::main` and from the Tauri `setup` hook in `os_gui/src-tauri/src/lib.rs`. Libraries (`core_engine`, `prolog_engine`) must not initialize a subscriber.

*CLI Verbosity*
- [✓] Add `-v / --verbose` flag (maps to `DEBUG`) and `-q / --quiet` flag (maps to `ERROR`) to the top-level `os_cli` `Cli` struct in `main.rs`.
- [✓] Pass resolved level through `LogConfig` into `logging::init`.

*Instrumentation — `core_engine`*
- [✓] Emit `tracing::info!("db connected")` once after SurrealDB initializes in `db.rs`.
- [✓] Emit `tracing::info!("event bus ready")` once when the `EventBus` starts.
- [✓] Emit `tracing::info!(blobs_removed = N, "gc sweep")` at the end of each GC pass.
- [✓] Emit `tracing::info!(hash = %hash, bytes = size, "blob stored")` in the CAS write path.
- [✓] Replace any remaining `eprintln!` / `println!` debug calls with `tracing::error!` or delete them.

*Instrumentation — `prolog_engine`*
- [✓] Emit `tracing::info!("prolog engine ready")` once after `ScryerMachine` initializes.
- [✓] Emit `tracing::warn!` on query failures (not on every query entry).

*Instrumentation — `os_gui` Tauri backend*
- [✓] Emit `tracing::info!("backend ready")` once in the Tauri `setup` hook.
- [✓] Emit `tracing::error!` in command handlers only on unrecoverable failures — not on every call.
- [✓] Add a `log_frontend` Tauri IPC command: `log_frontend(level: String, message: String)` that emits a `tracing` event tagged with `source = "frontend"`.

*Frontend — TypeScript*
- [✓] Add `logFrontend(level: 'warn' | 'error', message: string)` helper in `src/lib/log.ts` calling `invoke('log_frontend', { level, message })`.
- [✓] Replace `console.error` calls in IPC error paths (store actions) with `logFrontend('error', ...)`.

**Checks**
- [✓] Booting the app and running a full session (create entity, ingest file, run Prolog query) produces fewer than 15 `INFO` lines — each names the component and confirms a boundary was crossed.
- [✓] No log line appears inside a loop or on every IPC call under normal operation.
- [✓] Running `RUST_LOG=debug cargo run -p os_cli -- entity ls` emits structured debug output for DB calls.
- [✓] Running `cargo run -p os_cli -- -q entity ls` suppresses everything below `ERROR`.
- [✓] A JSON log file exists under the platform app-log directory after any GUI session.
- [✓] `grep -rn 'eprintln!\|println!' core_engine/src prolog_engine/src` returns zero matches (excluding `#[cfg(test)]` blocks).
- [✓] `cargo check --workspace` passes with zero warnings.
- [✓] `npm run build` passes with zero TypeScript errors.

**Design decisions**
- Decision: Log at system boundaries only (init, connect, sweep, ingest) — not per-operation.  
  Rationale: Verbose per-call logging masks real signals. A healthy run should produce a handful of `INFO` lines confirming each subsystem started and key operations completed. `DEBUG` is reserved for active development and is never on by default.
- Decision: Use `tracing` (not `log`) as the logging facade.  
  Rationale: The runtime is Tokio-based; `tracing` instruments async spans natively without the overhead of a bolt-on adapter.
- Decision: Initializer lives in `core_engine/src/logging.rs`, called only from binary entry points.  
  Rationale: Libraries must not own a global subscriber — only binaries (`os_cli`, `os_gui`) initialize one. This is a hard `tracing` contract.
- Decision: Frontend errors route through `log_frontend` IPC only for warnings and errors.  
  Rationale: Routine React renders and hover events belong in browser DevTools, not the system log.

### Phase 50: UI Utilities & UX Hardening
**Description**
Enhance the user experience with native integration for file management and quick identifier access.

**Tasks**
- [ ] **Native File Picker**: Implement native file explorer dialog integration (via Tauri's dialog API) to allow selecting single or multiple files for ingestion, replacing manual path entry in the GUI.
- [ ] **ULID Copy Tool**: Add a "Copy ULID" button to the `EntityInspector` and Registry list to quickly copy entity identifiers to the system clipboard.
- [ ] **Clipboard Feedback**: Integrate a brief "Copied!" tooltip or toast notification on successful clipboard write.
- [ ] **Entity list spacing**: Make the list items more compact, since now items are too high an contain empty space.
- [ ] **Right side bar selector order**: Place the Properties, Entities and relationships and Preview before any other panel.

**Checks**
- [ ] The file picker successfully passes file paths to the `core_engine` ingestion pipeline.
- [ ] ULIDs are correctly copied and can be verified by pasting into any text field.
- [ ] `npm run build` passes with zero TypeScript errors.

### Phase 45: Semantic Metadata Enforcement
**Description**
Harden the "flexible JSON" metadata bag by implementing Kind-specific schemas. This ensures that a `physical` entity *must* have certain fields while an `agent` requires others.

**Tasks**
- [ ] **Schema Registry**: Build a registration system in `core_engine` for `EntityKind` metadata requirements (using JSON Schema or similar).
- [ ] **Validation Middleware**: Add a validation step in `save_entity` that halts persistence if the provided metadata violates the Kind's schema.
- [ ] **GUI Form Generation**: Auto-generate property input fields in the `EntityInspector` based on the required schema for the entity's kind.

**Checks**
- [ ] Attempting to save a `physical` entity without a required `serial_number` metadata field fails with a descriptive error.
- [ ] The Inspector highlights missing but required fields in red.

---

## Potential Future Phases

> The following phases are defined for directional reference. They are not yet scheduled and should be promoted to the main roadmap when their prerequisites are met.

[] Add potential phase for database remove and populate with useful data script.
[] Add potential phase for improved and cleaned debug system.

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

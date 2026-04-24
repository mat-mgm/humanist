# Project Spatial OS

## Overview
A spatial operating system interface and backend.
* Purpose: A local-first, "Git for Data" Multimodal Intelligence Platform, managing nodes, edges, and blobs through generic, trait-based representations. It provides a unified environment to explore, interact with, and interconnect data, nodes, and spatial elements using a local database, PROLOG engine, and a window-managed GUI.
* Context: Built using a Rust backend internally structured with Hexagonal Architecture. It exposes functionality via a Tauri wrapper for the GUI and a CLI binary. The web-based frontend uses React, Vite, TypeScript, and Zustand. All environments are reproducible via NixOS `flake.nix`.
* Scope: Includes a CAS system, Prolog-based logic, a VS Code-style activity bar layout (default), a DWM-style tiling window manager (opt-in via Settings), a graph node viewer, a 3D globe viewer with causal timeline, an entity knowledge panel, and an integrated terminal.

## Status
Current status: in-progress
Start date: 
Last updated: 2026-04-22
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
  - **`os_gui` (Binary)**: Tauri 2.0 app with a Rust backend handling IPC commands. React frontend using atomic Zustand selectors for high-performance reactive UI updates, allowing 3D WebGL scenes to run isolated without stalling the main loop. Uses React Error Boundaries. Default shell is a VS Code-style activity bar layout (`ActivityBar` | resizable `SidePanel` | `PrimaryCanvas` | optional resizable right panel) with `lucide-react` icons throughout. The primary activities are **Inputs**, **Edition**, **Graph**, **Causal**, and **Terminal**. The **InputsPanel** serves as the primary gateway for entity creation and data ingestion, featuring a draft queue with stage-based progress tracking and storage maintenance tools (GC). The **Edition** activity is a single-canvas document workbench: the side panel manages entity/document selection and mode toggles, while the main canvas hosts either CodeMirror (with syntax highlighting for YAML, JSON, Markdown, and source-code formats including Python, Rust, C/C++, JavaScript/TypeScript, HTML, CSS, and more), inline binary preview renderers (PDF with natural/theme-color toggle, images, GLB/GLTF), or an embedded PTY running `$EDITOR`. The standalone Preview panel has been removed; all asset viewing is handled inline within the Edition canvas. `BlobTrait.mime` is the dispatch key for viewer selection; `infer_mime_from_path` in `core_engine` maps file extensions to MIME types for all common text and binary formats. The **Terminal** activity is a session workbench: the side panel launches and selects user-managed Shell / SQL / Prolog sessions, while the main canvas multiplexes one xterm surface across the active runtime session; editor-driven PTY sessions remain hidden from that selector. The **CausalPanel** merges Globe, Timeline, and Calendar into a single resizable-split view. The **EntityKnowledgePanel** merges Entities and Relationships into a tabbed view. The DWM tiling layout (`TilingLayout` via `react-dnd`) is preserved and activatable via the Settings panel. The **Settings panel** additionally exposes theme selection, a multi-locale language dropdown (en, de, fr, pt, es, ca, it, nl, zh, ja, ko, ar, ru), keyboard shortcut reference, and destructive data-management commands (`clear_database`, `clear_blob_store`) backed by Tauri IPC — each gated by an inline confirmation step. The right panel (toggled via `Ctrl+\`) surfaces Properties, Entities & Relations, and Edition as the first three pickers, followed by the visualisation panels.
* Ontology & Traits: Uses client-generated ULIDs and soft deletes. Data is generic and augmented by traits (`Entity`, `Spatial Trait`, `Blob Trait`, `Temporal Trait`). `BlobTrait` is the canonical file-content attachment layer and carries externally accessible blob metadata such as `filename`, `mime`, `hash`, `size`, and content-addressed `storage_id`, rather than duplicating path information in generic entity metadata. Context entities emit semantic edges. Entities may carry an `icon` key in their `metadata` JSON object (absolute file path) that renders as a circular icon overlay on the node in `GraphPanel`, set via the right-click "Set Icon…" action.
* **Relationship Type Visual Properties**: `RelationshipType` in `core_engine/src/models.rs` carries three optional visual fields: `flow: Option<String>` (directional layout bias: `down`, `right`, `up`, `left`), `routing: Option<String>` (edge path style: `straight`, `step`, `arc`), and `color: Option<String>` (CSS hex color). The flow field drives a per-tick d3-force velocity bias that decays with the simulation's alpha parameter. The routing field selects between ForceGraph2D's default straight line, an orthogonal L-path, and a quadratic bezier arc; non-straight edges suppress the default renderer (transparent `linkColor`, zero `linkWidth`) and are drawn entirely in `linkCanvasObject`. All arrowheads are snapped to the nearest cardinal axis (H or V) rather than following diagonal src→tgt vectors; when flow is set, the exact flow direction is used instead. Relationship types are auto-registered on first edge use (except `tagged_as`) so they appear in the Relationships panel without manual creation. `(from, to, label)` triples are deduplicated at write time so repeated calls (e.g. repeated tagging) do not create duplicate edges.
* **Graph Interaction**: Clicking a node selects it; double-clicking toggles its media preview. Edge click selects the edge, highlights it with the accent color, and shows a context menu with "Reify to Node" and "Delete Edge" actions. Edge reification (`reify_edge` Tauri command) atomically creates a new `abstract` entity, adds edges from source → node → target, and deletes the original edge. The node `val` (d3 repulsion / click-surface radius) is dynamically set to match the image footprint when a preview is active. Media preview open/closed state is persisted in `localStorage`. PDF previews render in natural colors (no theme recoloring). The background grid/dot matrix adapts to zoom level by stepping the world-space interval in multiples of 5 to keep screen-space spacing in the ~[30, 150] px range.
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
- [✓] "Load Full" on first launch no longer crashes the Knowledge Graph panel. *(fixed in Phase 54: graphLoading gate prevents ForceGraph2D from receiving data during the first load transition)*
- [✓] `cargo check --workspace` passes with zero warnings.
- [✓] `npm run build` passes with zero TypeScript errors.


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

### Phase 48: Ontological Model Refactor - Category, Persona, and Trait Separation
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

### Phase 50: Unified Inputs Panel & Evented Import Pipeline
**Description**
Replace the modal-based `CreateEntityDialog` and `IngestDialog` with a first-class `Inputs` activity placed first in the activity bar. The new panel becomes the canonical entry point for bringing data into the system through a unified queue of draft cards. Each card can represent either plain entity creation or file import, and imported files expose a per-card stage timeline driven by Tauri event-bus progress events so the pipeline is flexible, explainable, and inspectable. The panel also includes a compact storage-health section showing the current state of the database and blob store, plus a secondary manual garbage-collection action for maintenance.

**Tasks**
- [✓] **Activity bar integration**: Add a new `inputs` activity as the first item in `ActivityBar.tsx`, preserving the current primary-canvas behavior for Graph, Causal, and Terminal.
- [✓] **Inputs panel**: Create `InputsPanel.tsx` in the side panel layer as the replacement for both `CreateEntityDialog` and `IngestDialog`.
- [✓] **Unified draft-card queue**: Model the panel as a single queue of input drafts, where each card is either `create` or `import`.
- [✓] **Per-card stage timeline**: Implement expandable per-card timelines with explicit stages such as `source_selected`, `inspecting`, `storing_blob`, `creating_entity`, `attaching_blob_trait`, and `ready`.
- [✓] **Import Architecture B**: Implement import initiation as a command plus Tauri progress events keyed by `jobId`, with the frontend updating the matching draft card in place.
- [✓] **Native file selection**: Integrate Tauri native file picker and drag-and-drop so file imports no longer require manual path entry.
- [✓] **Storage health summary**: Add a compact section in the Inputs panel showing database and blob-store state, including at minimum entity count, blob count, and an estimate of blob-store size or tracked bytes.
- [✓] **Manual garbage collection**: Add a secondary `Run GC` action in the Inputs panel to trigger blob-store/database cleanup and surface a visible result summary such as removed blobs, reclaimed bytes, or a no-op outcome.
- [✓] **Keyboard routing**: Update `Ctrl+N` to open the Inputs panel and create/focus a `New entity` draft card; update `Ctrl+I` to open the Inputs panel and create one import draft card per selected file.
- [✓] **Success actions**: Auto-select newly created/imported entities and expose compact quick actions such as `Reveal in Graph`, `Open Preview`, and `Copy ULID`.
- [✓] **Modal removal**: Remove the old dialog-based entity creation and ingest entry points from the GUI shell.

**Checks**
- [✓] Creating a plain entity succeeds from an Inputs draft card with no modal dialog involved.
- [✓] Importing one file shows visible staged progress inside its card timeline and ends in a created entity with attached `BlobTrait`.
- [✓] Importing multiple files creates one visible draft card per file, each with independent progress and result state.
- [✓] `Ctrl+N` and `Ctrl+I` both route into the Inputs panel correctly.
- [✓] Drag-and-drop and native file picker both produce import draft cards without manual path typing.
- [✓] The Inputs panel shows current database/blob-store state without leaving the panel.
- [✓] Running GC from the Inputs panel completes successfully and reports what changed.
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] `cargo check --workspace` passes with zero warnings.

**Design decisions**
- Decision: Use a unified draft-card queue rather than permanent `Create` / `Import` tabs.
  Rationale: A single queue is the minimal abstraction that can scale to future input types without rebuilding the panel architecture again.
- Decision: Use per-card stage timelines instead of a single global import log.
  Rationale: Inspection belongs next to the unit of work. This keeps the system legible even during mixed or batched imports.
- Decision: Use Import Architecture B (`begin_import` + progress events + finished event).
  Rationale: It preserves Rust ownership of filesystem access while making the ingest pipeline observable in the frontend with minimal architectural weight.
- Decision: Include storage health and manual GC inside Inputs as a secondary maintenance section.
  Rationale: Although GC is not an ingress action, it is tightly coupled to the blob-store lifecycle and helps users understand and manage the consequences of import activity without hunting through unrelated panels.

**Notes / Risks / Resources**
- This phase intentionally overlaps the earlier “Native File Picker” utility request because file selection is a core part of the Inputs panel contract, not an isolated convenience feature.
- The current `ingest_entity(label, file_path)` command may survive temporarily as an internal helper, but the user-facing GUI flow should be driven by evented progress from the start.
- The maintenance section must remain visually secondary so the main reading of the panel is still “bring data in”, not “operate the database”.
- Reference design: [docs/notes/inputs_panel_phase_options.md](/home/rs/computation/programming/rust/spatial_os/docs/notes/inputs_panel_phase_options.md)

### Phase 51: Terminal Workbench - Typed Sessions & Left-Rail Selector
**Description**
Turn the Terminal activity into a proper workbench: the left side panel becomes the terminal session navigator and launcher, while the main canvas renders the currently selected terminal session. Users can create and switch between multiple long-lived Shell, SQL, and Prolog sessions during the current app run without mixing them into editor-driven temporary PTY sessions.

**Tasks**
- [✓] **Session model**: Introduce a first-class runtime session model for the Terminal activity with explicit session type (`shell`, `sql`, `prolog`), stable session id, title, lifecycle state, and visibility separate from temporary editor sessions.
- [✓] **Left side selector**: Replace the current Terminal side-panel placeholder with a dedicated session workbench showing environment launch actions (`New Shell`, `New SQL`, `New Prolog`) and the list of visible terminal sessions.
- [✓] **Canvas/session split**: Keep the selected terminal session in the main canvas only; the left side panel must act strictly as selector/launcher, not as a second terminal surface.
- [✓] **Long-lived typed sessions**: Make Shell, SQL, and Prolog true long-lived interactive sessions that preserve their own prompt state, scrollback, and command context while the app remains open.
- [✓] **Session switching**: Allow jumping between multiple sessions of any type without losing the inactive sessions' state.
- [✓] **Hidden editor sessions**: Keep `edit-<entity>` and other temporary editor-backed sessions out of the left-panel session list so the workbench only exposes user-managed terminal sessions.
- [✓] **Close/fallback rules**: Add explicit close behavior for visible sessions and define deterministic fallback selection when the active visible session is closed.
- [✓] **Keyboard workflow**: Preserve the keyboard-centric flow by allowing the Terminal activity to open directly into the current visible session and by keeping session creation/switching reachable through focusable side-panel controls rather than mouse-only UI.

**Checks**
- [✓] Creating a Shell session from the left panel opens it in the main canvas and leaves previously opened sessions intact.
- [✓] Creating multiple Shell / SQL / Prolog sessions shows each one in the left-panel selector and switching between them preserves per-session state.
- [✓] SQL and Prolog sessions behave as true interactive long-lived sessions during the current app run rather than one-shot query dialogs.
- [✓] Closing the active visible session selects a sensible remaining visible session without leaving the terminal canvas in a broken state.
- [✓] Temporary editor sessions such as `edit-<entity>` do not appear in the left-panel session selector.
- [✓] Restarting the app clears runtime terminal sessions, matching the current-run-only persistence rule.
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] `cargo check --workspace` passes with zero warnings.

**Design decisions**
- Decision: The left side panel is the terminal workbench navigator; the terminal canvas stays in the main canvas area.
  Rationale: This keeps the shell surface large and readable while giving session management a stable, low-chrome home in the existing activity layout.
- Decision: Session types are first-class runtime concepts (`shell`, `sql`, `prolog`) rather than labels over one generic shell.
  Rationale: True long-lived sessions require stable ownership of prompt state, history, and lifecycle per environment.
- Decision: Terminal sessions persist only for the current app run.
  Rationale: This is the minimal durable behavior for now and avoids premature restart-recovery complexity.
- Decision: Editor-driven PTY sessions remain hidden from the session selector.
  Rationale: The workbench should expose only user-managed terminal sessions, not implementation-detail sessions spawned by file editing flows.

**Notes / Risks / Resources**
- True long-lived SQL and Prolog sessions imply session-local prompt state, history, and output buffering rather than one-shot command execution.
- SQL and Prolog history is shared per session type and persisted across app runs, while the runtime sessions themselves remain current-run-only.
- The current terminal already multiplexes a single xterm canvas across PTY session ids; this phase should generalize that pattern instead of introducing a second terminal rendering stack.
- The selector should stay suckless: session type, title, and state are enough for the first iteration; tab bars and extra chrome are unnecessary.

### Phase 52: Edition Panel
**Description**
Add a first-class `Edition` activity to the activity bar. The panel provides a unified surface for reading and modifying any entity's full content: its structured database record (serialized as editable YAML/JSON) and its attached text files (notes, JSON, plain text blobs). A single canvas occupies the primary area; the left side panel hosts document navigation plus mode/format controls. The canvas can render CodeMirror for text editing, embedded xterm.js for `$EDITOR`, or inline viewers for binary blobs (PDF, image, GLB).

Every entity automatically receives a canonical notes file (`{snake_case_label}.md`) at creation time. This file is stored as a `BlobTrait` in the CAS, always appears first in the document list, and is the primary free-form writing surface for that entity.

**Design decisions**
- Decision: Proposal A - Single Canvas, Document Switch.  
  Rationale: Entity YAML and notes file are at equal priority; switching by keypress is sufficient; one notes file per entity is the common case; single canvas maximises editor real estate and keeps the implementation minimal.
- Decision: CodeMirror as the baked-in web editor.  
  Rationale: Proper syntax highlighting and line numbers are required; CodeMirror is lighter than Monaco and has no extension marketplace complexity.
- Decision: Auto-created notes file on entity creation, named `{snake_case_label}.md`.  
  Rationale: Every entity should have a notes surface immediately without an explicit import step. Naming by snake-cased label keeps the filename human-readable and deterministic.
- Decision: Binary blobs render inline inside the Edition canvas.  
  Rationale: This keeps document switching local to the Edition workflow and reuses the existing PDF / image / GLB viewers without forcing a panel hop.
- Decision: Terminal mode replaces the canvas entirely - only for text-based documents.  
  Rationale: `$EDITOR` (Neovim) must be a full-fidelity replacement, not a side-by-side widget. Binary blobs are excluded because the terminal cannot render them.

**Tasks**

- [✓] **`edition` activity**: Add an `Edit` (Pencil) Lucide icon entry to the activity bar between Inputs and Graph.
- [✓] **Store state**: Add `editionEntityId`, `editionDocKey`, `editionMode`, and `editionFormat`, plus helpers for reading/writing entity and blob documents.
- [✓] **Notes lifecycle**: Add `create_entity_notes`, `read_blob_content`, `write_blob_content_by_id`, `edit_blob_in_terminal`, `delete_blob_trait`, and `rename_blob_trait` Tauri commands, then call notes creation automatically from the frontend entity-creation flow.
- [✓] **Side panel**: Build an Edition side panel showing the current entity, ordered document list, notes creation / rename / delete actions, and mode/format toggles.
- [✓] **Web editor**: Render CodeMirror in the main canvas for entity YAML/JSON and text blobs, with syntax detection, dirty tracking, `Ctrl+S`, and save/discard controls.
- [✓] **Terminal editor mode**: Mount a dedicated PTY canvas for `$EDITOR` and wire it to `edit_entity_in_terminal` / `edit_blob_in_terminal`.
- [✓] **Inline binary preview**: Render image, PDF, and GLB blobs directly in the Edition canvas rather than opening a separate panel.
- [✓] **Document navigation**: Support ordered document switching via `Alt+[` / `Alt+]`.
- [✓] **Remove standalone Preview panel**: Remove the Preview panel from the activity bar, right-panel picker, and default tiling slots; all asset viewing moves into the Edition canvas inline viewers.
- [✓] **Broad code-file MIME support**: Extend `infer_mime_from_path` to cover source code formats (Python, Rust, C/C++, JS/TS, HTML, CSS, Nix, Lua, SQL, Go, Shell, etc.) and add corresponding CodeMirror language extensions so code files open in the editor rather than falling back to binary view.
- [✓] **CAS deduplication fix for notes**: New entity notes files use a ULID-keyed path under `notes/` via `alloc_empty()`, bypassing the content-addressed deduplication that caused all empty notes to share one physical file.
- [✓] **CBOR deserialisation fix**: Change `get_blob_traits` query from `SELECT *` to explicit field selection to prevent SurrealDB `RecordId` CBOR revision-150 deserialisation errors.

**Checks**
- [✓] Creating a new entity automatically produces a `{snake_case_label}.md` blob visible in the Edition Panel document list.
- [✓] Switching documents with `Alt+[` / `Alt+]` cycles through entity doc and all attached blobs in order.
- [✓] Editing the entity YAML in web mode and saving updates the entity and traits visible in the Graph and Inspector panels without a full reload.
- [✓] Editing the notes file in web mode saves new content; re-opening the panel reloads the updated content.
- [✓] Selecting a binary blob in the side panel loads an inline preview in the Edition canvas.
- [✓] Switching to terminal mode opens xterm.js with `$EDITOR` running on the selected text document.
- [✓] CodeMirror applies syntax highlighting for entity YAML/JSON and all common text blob types: Markdown, JSON, YAML, Python, Rust, C/C++, JavaScript/TypeScript (JSX/TSX), HTML, CSS/SCSS.
- [✓] Binary blobs (PDF, image, GLB) open inline in the Edition canvas; the standalone Preview panel no longer exists.
- [✓] Multiple blobs attached to the same entity all appear in the side-panel document list and are individually selectable.
- [✓] Newly created notes files for different entities are stored as distinct physical files (no CAS collision on empty content).
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] `cargo check --workspace` passes with zero warnings.

**Notes / Risks / Resources**
- CodeMirror dependencies: `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-yaml`, `@codemirror/lang-markdown`, `@codemirror/lang-json`, `@codemirror/lang-python`, `@codemirror/lang-rust`, `@codemirror/lang-cpp`, `@codemirror/lang-javascript`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/legacy-modes` (for LaTeX/stex via `StreamLanguage`).
- The PDF viewer defaults to natural document colors; a "Theme" toggle in the toolbar applies the CSS-variable color remapping for dark/light theme integration.
- The 3D (GLB/GLTF) viewer background uses CSS custom properties (`--bg-panel`, `--bg-secondary`, `--bg-primary`) for theme-adaptive gradient, not hardcoded colors.
- The `write_blob_content_by_id` command follows immutable CAS semantics - it creates a new CAS object and updates the `BlobTrait` pointer. Old content survives until the next GC pass. This is intentional: it preserves blob history at the cost of slightly more disk usage.
- `edit_entity_in_terminal` already exists and handles the YAML temp-file + PTY flow. This phase wires it into the Edition Panel canvas rather than using it from the Inspector escape hatch.
- The auto-notes creation in the frontend entity flow must remain idempotent: if a notes blob for the entity already exists (e.g., after a restart and re-import), do not create a duplicate.
- Reference design: [docs/notes/edition_panel_proposals.md](docs/notes/edition_panel_proposals.md)

---

### Phase 53: UI Polish & Application Shell Hardening
**Description**
Consolidate accumulated UX improvements into the application shell: panel layout polish, relationships panel UX, window management, data reset tools, and locale expansion.

**Tasks**

*Panel & layout polish*
- [✓] **Relationships panel improvements**: Rename `OntologyPanel` export to `RelationshipsPanel`; add search bar; render type list as a table with Label / Flags headers; move "New Type" form above the list.
- [✓] **Entity list scrollbar**: Wrap the `EntityRegistry` table in a scrollable container so long entity lists do not overflow the panel.
- [✓] **Icon cleanup**: Replace remaining `✕` text-button delete/remove actions in `EntityInspector` with `<Trash2>` or `<Minus>` lucide icons; reserve `<X>` for dismiss/close actions only.
- [✓] **Right panel selector order**: Place Properties, Entities & Relations, and Edition before visualisation panels (Graph, Globe, Timeline, Calendar, Terminal) in the right-panel picker.

*Window management*
- [✓] **Window control permissions**: Add `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, and `core:window:allow-close` to the Tauri capabilities manifest so the titlebar buttons function correctly.

*Data management*
- [✓] **Clear database**: Add a `clear_database` Tauri command and a "Clear Database" button in the Settings panel (with inline confirmation) to wipe all SurrealDB records and start blank.
- [✓] **Clear blob store**: Add a `clear_blob_store` Tauri command and a "Clear Blob Store" button in the Settings panel (with inline confirmation) to remove all physical blob files.

*Locale*
- [✓] **Language dropdown expansion**: Add Catalan (`ca`), Italian (`it`), Dutch (`nl`), Japanese (`ja`), Korean (`ko`), and Russian (`ru`) to the Settings language selector.

**Checks**
- [✓] Titlebar minimize, maximize/restore, and close buttons respond on click.
- [✓] Relationships panel displays a scrollable table with a working search filter and the New Type form at the top.
- [✓] Right panel picker shows Properties → Entities & Relations → Edition as the first three entries.
- [✓] "Clear Database" with confirmation wipes all entity/trait/edge/history data; the graph and inspector show empty state afterwards.
- [✓] "Clear Blob Store" with confirmation removes all blob files; blob count in the Inputs panel drops to zero.
- [✓] Catalan and other newly added locales appear in and are selectable from the Settings language dropdown.
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] `cargo check --workspace` passes with zero warnings.

### Phase 54: Graph View Refinements
**Description**
A focused set of graph-view quality improvements: fix the first-launch crash on "Load Full", add keyboard-driven node navigation, enforce selection ordering, modernise arrowheads, add a background-style toggle, fix tag-label overlap, introduce a soft-fill region style variant, add a `visible` flag to relationship types (hiding tag edges by default), and surface selection-aware tag/relate actions directly in the graph side panel.

**Tasks**

*Bug fixes*
- [✓] **Fix Load Full first-launch crash**: Gate the data passed to `ForceGraph2D` behind a `graphLoading` boolean in the store. Set it `true` at the start of `loadFullGraph`, and set it `false` only after both `entities` and `edges` are committed to state. In `GraphPanel`, pass an empty array to `ForceGraph2D` while `graphLoading` is `true`, then swap in real data once loading is complete. This eliminates the stale-node-reference in the d3 simulation tick that causes the first-launch crash.

*Keyboard navigation*
- [✓] **Arrow key node navigation**: In `GraphPanel`, attach a `keydown` listener (active when the panel is focused). When a node is selected and an arrow key is pressed, find the graph node whose screen-space position forms the smallest angular deviation from the arrow direction within a ±45° cone and select it, centering the viewport on it via `ForceGraph2D.centerAt`. If no node is found in the cone, do nothing.
- [✓] **Space to toggle selection**: Pressing `Space` on a focused graph node adds it to `selectedIds` if absent, or removes it if present (multi-selection toggle without mouse).
- [✓] **Escape to deselect all**: Pressing `Escape` in the graph panel calls `clearSelection()` in the store.
- [✓] **Auto-center selected node**: After any programmatic selection change (arrow nav, space), call `ForceGraph2D.centerAt(node.x, node.y, 300)` to smoothly pan the selected node into view.

*Selection ordering*
- [✓] **Ordered selection**: `selectedIds` is already an ordered `string[]` in the Zustand store (appended via `[...selectedIds, id]`). Fixed `EntityInspector` to iterate `selectedIds` order (via `selectedIds.map(id => entities.find(...))`) rather than `entities.filter()` which used entity-list order.

*Visual polish*
- [✓] **Enlarge graph explore bar**: Increased height from 24 px to 28 px and padding from `3px 8px` to `5px 10px` in `GraphSidePanel.tsx`.
- [✓] **Modern arrowheads**: Replaced the built-in filled triangle (`linkDirectionalArrowLength`) with a custom open-chevron arrowhead drawn in `linkCanvasObject` — two lines from the tip at ±22°, no filled shape. Arrowhead color matches the edge stroke.
- [✓] **Background style toggle** (`grid` | `dots`): Added `backgroundStyle: 'grid' | 'dots'` to the Zustand store (default `'grid'`). `GraphPanel` switches between grid lines and a dot-matrix pattern in `onRenderFramePre`. Grid/Dot icon toggle in `GraphSidePanel`.
- [✓] **Prevent tag-label overlap**: Two-pass render in `onRenderFramePre`: pass 1 builds hulls + label anchors; pass 3 runs a greedy push-up collision loop over sorted label positions before drawing.

*Tag region styling*
- [✓] **Region style selector** (`hatch` | `fill`): Added `regionStyle: 'hatch' | 'fill'` to the Zustand store (default `'hatch'`). Fill mode draws 15% opacity solid background + 2 px solid border. Hatch/Fill button toggle in `GraphSidePanel` below the Regions toggle.

*Relationship visibility*
- [✓] **`visible` flag on `RelationshipType`**: Added `visible: bool` (default `true`) to `RelationshipType` in `core_engine/src/models.rs`, SurrealDB schema, and TypeScript `models.ts`. Seeded `tagged_as` with `visible: false` at schema init.
- [✓] **Filter invisible edges**: `filteredData` in `GraphPanel` excludes edges whose label matches a `RelationshipType` with `visible = false`.
- [✓] **Toggle in Relationships panel**: Eye/EyeOff icon button per row in `RelationshipsPanel` type table; `visible` checkbox in the New Type form.

*Selection-aware side panel actions*
- [✓] **Contextual selection section in `GraphSidePanel`**: When `selectedIds.length >= 1`, a compact section appears at the bottom of the panel with a tag-all input and a Relate selection button (opens `RelateDialog` from the first selected entity). Section is hidden when no nodes are selected.

*Bug fixes*
- [✓] **ResizeObserver staleness fix**: Changed `useEffect` deps from `[]` to `[graphMountKey]`; reads `containerRef.current` inside the ResizeObserver callback so it tracks the live container after each full-load transition. Added explicit `g.width(w).height(h)` call immediately after ForceGraph2D construction.
- [✓] **Relationship types missing from panel**: `add_edge` in `db.rs` auto-inserts a `relationship_type` row on first use of any new label (skipping `tagged_as`), so all edge labels appear in the Relationships panel without manual registration.
- [✓] **Duplicate tag edges**: `add_edge` checks for an existing `(from, to, label)` edge before inserting, preventing duplicate edges from repeated tag/relate calls.
- [✓] **Hide default ForceGraph2D line for custom-routed edges**: Non-straight routing (`step`, `arc`) suppresses the default renderer (`linkColor` → transparent, `linkWidth` → 0); the path is drawn entirely in `linkCanvasObject`.
- [✓] **Flow force decay fix**: Uses the `alpha` argument d3 passes to the force function (not `g.d3AlphaTarget()`); `bias = 0.6 * alpha` decays naturally to zero as the simulation cools.
- [✓] **Arrow directionality**: Arrowheads snap to the nearest cardinal axis (H or V). When `flow` is set on the relationship type the exact flow direction is used; otherwise the dominant axis of the src→tgt vector is used.

*Relationship type visual properties*
- [✓] **`flow`, `routing`, `color` on `RelationshipType`**: Added to `models.rs`, `db.rs` schema, `save_relationship_type` Tauri command, `models.ts`, and `store.ts`.
- [✓] **Routing-aware edge drawing**: `linkCanvasObject` dispatches on `rt.routing`: `step` draws an orthogonal L-path, `arc` draws a quadratic bezier; `straight` falls through to ForceGraph2D's default renderer.
- [✓] **Directional d3-force layout**: `g.d3Force('flow', ...)` applies per-tick velocity bias along the flow axis, decaying with alpha.
- [✓] **Adaptive background grid / dot matrix**: World-space step scales in ×5 / ÷5 multiples to keep screen-space spacing in ~[30, 150] px range at all zoom levels.
- [✓] **Solid concave arrowheads**: Replaced open chevrons with a filled concave-kite shape via `quadraticCurveTo`; color matches the edge.
- [✓] **Dot matrix contrast**: Dot alpha raised to 0.7.
- [✓] **Tag edges hidden on startup**: `App.tsx` bootstrap calls `fetchRelationshipTypes()` so `invisibleLabelsRef` is seeded before the first graph render.
- [✓] **Inline relationship type editing**: `RelationPanel` pencil icon replaces a row inline with an `EditRow` exposing all fields: label, flow, routing, color, transitive, symmetric, inherits_traits, visible.

*Node interaction*
- [✓] **Double-click to toggle media preview**: Two clicks on the same node within 400 ms triggers the image/PDF preview toggle; single click always selects.
- [✓] **Miniature in real color**: Removed pixel-level theme color reinjection from PDF preview rendering; thumbnails display in natural colors.
- [✓] **Node size matches miniature for repulsion / click surface**: `n.val` is set dynamically when a preview is active so d3 repulsion and click-hit-detection match the image footprint.
- [✓] **Persist miniature open/closed state**: `toggledImageNodes` set is persisted in `localStorage` (`spatial-os:toggled-image-nodes`) and restored on component mount.
- [✓] **Node icons**: Right-click → "Set Icon…" opens a native file picker (`pick_icon_file` via `rfd`), stores the path in `entity.metadata.icon`, and renders a 32 px circular icon on the node. "Clear Icon" removes it. Icons are always shown (not toggled).

*Edge interaction*
- [✓] **Edge selection**: Clicking a link highlights it with the accent color (thicker stroke) and shows an edge context menu. Background or node click dismisses the menu.
- [✓] **Edge reification**: "Reify to Node" in the edge context menu calls `reify_edge` (Tauri command), which atomically creates a new `abstract` entity, adds `source → node → target` edges, and deletes the original edge.
- [✓] **Delete edge from context menu**: "Delete Edge" in the edge context menu calls `remove_edge`.

**Checks**
- [✓] Clicking "Load Full" immediately after first launch loads the graph without crashing; the error boundary is never triggered.
- [✓] After "Load Full", the canvas fills the entire container with no blank gap to the right.
- [✓] With a node selected, pressing `→` selects the nearest node to the right; pressing `↑` selects the nearest node above; pressing `Escape` clears the selection.
- [✓] Pressing `Space` on a focused node toggles it in/out of the multi-selection without clearing other selected nodes.
- [✓] The EntityInspector lists selected entities in the order they were selected, not alphabetically or by ID.
- [✓] The graph explore bar is visibly wider and more comfortable to type in.
- [✓] All user-created relationship types (e.g. `depends_on`) appear in the Relationships panel, not just `tagged_as`.
- [✓] Tagging an entity twice does not produce duplicate `tagged_as` edges.
- [✓] Arrowheads are solid concave kite shapes; all arrow tips point perfectly horizontal or vertical.
- [✓] Edges with `step` routing draw an L-shaped orthogonal path; `arc` draws a smooth curve; neither shows a duplicate straight line underneath.
- [✓] Setting a relationship's flow to `right` and reloading does not push nodes off-screen; the simulation converges normally.
- [✓] Editing a relationship type's label, color, or routing takes effect immediately on the graph.
- [✓] Switching background style to "dots" replaces grid lines with evenly spaced dots that scale with zoom; switching back restores the grid.
- [✓] With multiple tagged nodes visible, no two tag-region labels overlap at any zoom level.
- [✓] Switching region style to "fill" draws a solid transparent background and solid border; switching back to "hatch" restores the original pattern.
- [✓] Edges with `visible = false` relationship type do not appear on the canvas; toggling the eye icon in the Relationships panel immediately shows/hides the corresponding edges.
- [✓] `tagged_as` edges are hidden by default on a fresh database; toggling their type to visible shows them.
- [✓] Selecting one or more nodes in the graph reveals the Tag/Relate section in the left side panel; deselecting all hides it.
- [✓] Double-clicking a node with an attached image/PDF toggles the preview; single click selects.
- [✓] PDF previews display in natural paper colors, not theme colors.
- [✓] Toggled previews are still open after an app restart.
- [✓] Clicking an edge highlights it and shows the edge context menu.
- [✓] "Reify to Node" converts the selected edge into a node connected to both endpoints.
- [✓] "Set Icon…" on a node opens a native file picker and renders the chosen image as a circular icon on the graph node.
- [✓] `npm run build` passes with zero TypeScript errors.
- [✓] `cargo check --workspace` passes with zero warnings.

**Design decisions**
- Decision: Use `alpha` parameter (not `g.d3AlphaTarget()`) in the flow force function.
  Rationale: `d3AlphaTarget()` returns the *target* (always 0 at rest), not the *current* alpha — using it as a multiplier makes the force constant, causing runaway node velocity.
- Decision: Snap arrowheads to cardinal (H or V) axis globally.
  Rationale: Diagonal arrowheads look unclean at any angle; cardinal snapping gives a consistent, grid-aligned aesthetic regardless of where nodes settle in the simulation.
- Decision: Store node icon path in `entity.metadata.icon` rather than a dedicated `IconTrait` table.
  Rationale: Icons are a lightweight cosmetic property; the metadata bag is already flexible JSON and `update_metadata` is an existing IPC endpoint.
- Decision: Implement `reify_edge` as a single Tauri command rather than composing frontend store actions.
  Rationale: Atomic execution prevents a partial state (node created, original edge not yet deleted) from being visible to the user.

**Design decisions**
- Decision: Gate `ForceGraph2D` data on a `graphLoading` flag rather than retrying on error.
  Rationale: Feeding an empty array during the load transition is the minimal, non-destructive fix — no retry logic, no timing hacks, no change to the error boundary.
- Decision: Arrow navigation uses a ±45° directional cone, not strict axis alignment.
  Rationale: A strict axis (±0°) would almost never match a real node position; 45° gives an ergonomic "nearest in that direction" feel while remaining deterministic.
- Decision: `visible` flag lives on `RelationshipType`, not individual edges.
  Rationale: Visibility is a semantic property of the relationship class (e.g. `tagged_as` is always structural/invisible); per-edge overrides would add complexity without a clear use case now.
- Decision: Keep `hatch` as the default region style.
  Rationale: The hatch pattern is already implemented and visually distinctive; `fill` is additive, not a replacement.

### Phase 55: Linux Packaging & AppImage Build Shell
**Description**
Enable first-class Linux packaging for the Tauri GUI and make AppImage bundling work from the Nix flake by separating the regular development shell from a dedicated FHS packaging shell.

**Tasks**
- [✓] Enable Tauri bundling in `os_gui/src-tauri/tauri.conf.json` so native Linux artifacts are produced by `cargo tauri build`.
- [✓] Verify Linux package generation for `.deb` and `.rpm` outputs from the existing Tauri build pipeline.
- [✓] Refactor `flake.nix` to keep a standard `default` development shell for everyday work.
- [✓] Add a dedicated `appimage` FHS dev shell exposed as `nix develop .#appimage`.
- [✓] Include the AppImage bundling prerequisites in that shell, including `xdg-utils`, so `/usr/bin/xdg-open` is available where the Tauri AppImage script expects it.
- [✓] Document the operational packaging flow: use `nix develop` for normal development and `nix develop .#appimage` when building AppImages on NixOS.

**Checks**
- [✓] `cargo tauri build` produces Linux bundle artifacts under `target/release/bundle/`.
- [✓] `target/release/bundle/deb/` contains a usable `.deb` package.
- [✓] `target/release/bundle/rpm/` contains a usable `.rpm` package.
- [ ] Inside `nix develop .#appimage`, `ls /usr/bin/xdg-open` succeeds.
- [ ] `cargo tauri build --bundles appimage` completes successfully from the `appimage` shell.


# Labyrinth Game

> Working title

Labyrinth Game is a multiplayer-first procedural labyrinth exploration game inspired by stealth games, horror games, old-school pixel games, and social deduction.

The project is intended to be developed almost entirely with AI-assisted programming while remaining maintainable, well-documented, deterministic, and easy for humans to extend.

This document serves as:

- Project overview
- Game Design Document
- Architecture specification
- Development guidelines
- AI prompt for future coding sessions

If future AI sessions produce code that conflicts with this document, this document is considered the source of truth.

---

# Vision

The player enters a procedurally generated labyrinth where navigation, sound, memory and teamwork are more important than reflexes.

Players cannot always see everything around them.

Instead they rely on:

- exploration
- remembered terrain
- fog of war
- sound visualization
- communication
- strategy

The game should encourage exploration and uncertainty rather than perfect information.

---

# Core Gameplay

Players spawn inside a procedurally generated labyrinth.

A match consists of:

- exploring
- surviving
- locating objectives
- escaping
- defeating enemies (depending on game mode)

The exact objectives should be configurable so multiple game modes can exist.

Possible game modes:

- Exploration
- Escape
- Last Man Standing
- Team Deathmatch
- Capture Objectives
- Infection
- Hide and Seek
- King of the Hill
- PvE Survival
- Custom community modes

---

# Multiplayer

Multiplayer is the primary focus.

Target player counts:

- 2–16 players
- Dedicated servers
- Listen servers
- Private servers
- LAN support

Players should be able to:

- create lobbies
- invite friends
- vote on map seed
- vote on game mode
- vote on modifiers

The networking should be authoritative server architecture.

Clients should never be trusted.

---

# Single Player

Single-player should be fully supported.

Players may:

- play alone
- add AI bots
- create custom games
- practice maps

Bots should use the same game rules as players.

---

# Procedural Generation

Every match generates a completely new labyrinth.

Generation must be deterministic.

Inputs:

- Seed
- Game mode
- Size
- Difficulty
- Enabled modifiers

The same seed should always generate the exact same labyrinth.

Possible generation settings:

- Tiny
- Small
- Medium
- Large
- Huge

Future expansions:

- biome themes
- underground ruins
- laboratories
- castles
- caves
- temples
- forests

---

# Fog of War

Players begin with no map knowledge.

Visible areas become permanently remembered.

Unvisited locations remain hidden.

The remembered map should:

- darken over time
- indicate visited locations
- optionally allow map sharing between teammates

Possible upgrades:

- magical map
- radar
- sonar
- shared squad intelligence

---

# Sound / Echo Location System

One of the game's signature mechanics.

Sound should be visualized.

Examples:

Walking:
small ripple

Running:
large ripple

Explosion:
massive shockwave

Gunfire:
directional pulse

Door opening:
medium ripple

Voice chat:
localized pulse

Player screaming:
very large ripple

Different materials produce different sounds.

Examples:

Stone

Metal

Wood

Water

Grass

Sand

Sneaking dramatically reduces sound.

Certain equipment can eliminate sound entirely.

Shockwaves should temporarily distort nearby graphics.

---

# Stealth

Stealth is an important gameplay mechanic.

Possible mechanics:

- crouching
- hiding
- darkness
- camouflage
- silent footwear
- smoke
- decoys
- throwable distractions

---

# Combat

Combat should remain simple.

Possible weapons:

- melee
- pistols
- rifles
- bows
- explosives
- traps
- lasers

Animations are intentionally minimal.

Gameplay should take priority over visual fidelity.

---

# Art Style

Top-down pixel art.

Requirements:

- low resolution sprites
- minimal animation
- readable silhouettes
- dynamic lighting
- fog of war
- particles
- shadows
- simple UI

---

# Audio

Sound is gameplay.

Audio must support:

- positional sound
- volume attenuation
- occlusion by walls
- directional hearing

Future support:

- HRTF
- surround sound

---

# User Interface

Simple.

Fast.

Minimal.

Required screens:

- Main Menu
- Lobby Browser
- Server Browser
- Host Game
- Join Game
- Settings
- Keybinds
- Controller
- Accessibility
- Credits

HUD:

- minimap
- remembered map
- compass
- inventory
- chat
- player list
- ping
- FPS
- debug overlay

---

# Chat

Required:

- global
- team
- private
- system

Future:

- voice chat
- proximity chat
- radio

---

# Accessibility

Support:

- controller
- keyboard
- remappable controls
- colorblind modes
- subtitles
- scalable UI
- screen shake reduction
- flashing light reduction

---

# Modding

The game should be moddable.

Goals:

- custom maps
- custom game modes
- custom items
- custom AI
- custom textures
- custom sounds

Mods should never require editing core game code.

---

# Server

Dedicated server.

Requirements:

- Linux support
- Windows support
- Docker image
- configuration files
- REST administration API
- WebSocket administration
- metrics endpoint

Support:

- clustering
- multiple game instances
- matchmaking
- server browser

---

# Security

Authoritative server.

Required:

- anti-cheat validation
- signed builds
- protocol version checks
- resource validation
- checksum verification

Servers should optionally reject:

- modified clients
- modified assets
- mismatched versions

---

# Networking

Suggested transport:

WebSockets.

Possible future:

WebRTC
UDP
QUIC

Networking should support:

- prediction
- interpolation
- lag compensation

---

# Technology Stack

Preferred stack:

Frontend

- TypeScript
- React
- PixiJS

Game Engine

- PixiJS

Backend

- Node.js
- TypeScript
- Fastify

Realtime

- WebSockets

Database

- PostgreSQL

Cache

- Redis

Authentication

- JWT

Desktop

- Electron

Android

- Capacitor

---

# Project Structure

/apps
/client-web
/client-desktop
/client-mobile
/server
/shared
/tools

/packages
/common
/network
/protocol
/assets
/math
/ecs

/docs

---

# Coding Standards

All code should:

- be documented
- avoid unnecessary complexity
- avoid duplication
- be modular
- be unit tested where practical

Avoid:

- global state
- giant files
- giant classes
- circular dependencies

Favor:

- composition
- dependency injection
- deterministic systems

---

# Documentation

Every feature should include:

- overview
- architecture
- networking notes
- screenshots (when available)
- future improvements

---

# Development Philosophy

Priorities:

1. Fun gameplay
2. Maintainability
3. Multiplayer correctness
4. Performance
5. Graphics

Never sacrifice architecture simply to implement a feature faster.

---

# AI Development Rules

Future coding agents should:

- Read this document first.
- Never rewrite architecture without explanation.
- Never silently change networking.
- Keep commits small.
- Explain important decisions.
- Update documentation whenever code changes.
- Prefer TODOs over unfinished implementations.
- Never invent game mechanics without documenting them.
- Ask before introducing breaking changes.

---

# Future Ideas

- Day/Night cycle
- Weather
- Dynamic lighting
- Random events
- Monsters
- Bosses
- Treasure rooms
- Secret passages
- Traps
- Destructible walls
- Dynamic music
- Replay system
- Spectator mode
- Match recording
- Steam integration
- Discord Rich Presence
- Achievements
- Cosmetic unlocks
- Statistics
- Leaderboards
- Dedicated replay viewer

---

# Long-Term Goal

Create a game that is:

- replayable
- moddable
- multiplayer-first
- deterministic
- highly maintainable
- enjoyable to extend with AI-assisted development

Every architectural decision should support these goals.

# Core Design Pillars

Every gameplay system should reinforce these principles.

## Information is Limited

Players should never possess perfect information.

Knowledge is earned through exploration, teamwork, observation and listening.

Examples:

- Fog of war
- Limited vision
- Sound visualization
- Remembered map
- Communication with teammates

## Knowledge Ages

The player's memory is not perfect.

Previously explored areas become "stale" over time.

The player remembers where they have been, but cannot know whether something has changed without revisiting it.

Examples:

- Doors may have changed state.
- Players may have moved.
- Traps may have been activated.
- Items may have disappeared.
- Objectives may have changed.
- Monsters may have wandered elsewhere.

The minimap should visually distinguish:

- Currently visible
- Recently explored
- Previously explored
- Unknown

This mechanic should create uncertainty without becoming frustrating.

## Sound Is Vision

Sound is one of the player's primary senses.

Rather than merely hearing sounds, players also perceive visualized sound waves.

Every sound event should produce an expanding wave.

Examples:

- Walking
- Sprinting
- Reloading
- Opening doors
- Voice chat
- Gunfire
- Explosions
- Breaking walls
- Dropping items

Sound waves should never reveal more information than physically plausible.

## Sound Propagation

Sound should propagate through the labyrinth rather than ignoring walls.

Each sound event has:

- Base volume
- Frequency profile
- Maximum travel distance
- Material interaction
- Occlusion

Walls should attenuate sound.

Examples:

Stone:
heavy attenuation

Wood:
medium attenuation

Metal:
can resonate

Open doorway:
minimal attenuation

Each wall crossed should reduce the sound intensity.

Eventually the sound should become too weak to visualize.

Large explosions should still be visible through multiple walls.

Footsteps should usually disappear after only a few walls.

Whenever possible, sound propagation should use pathfinding rather than simple Euclidean distance, preventing sounds from unrealistically travelling through thick structures.

Future improvements may include:

- Echoes
- Reverberation
- Directional reflections
- Large open rooms amplifying sound
- Narrow corridors funneling sound

## Hearing vs. Seeing

Players should never gain perfect positional information from sound alone.

Instead, sound provides **probabilistic information**. Louder and clearer sounds reveal more precise information, while quieter or heavily occluded sounds become increasingly ambiguous.

Every sound event generates a visualization whose appearance depends on several factors:

- Volume
- Distance
- Number of walls crossed
- Wall materials
- Ambient environmental noise
- Directionality
- Frequency profile

The goal is to make players interpret sounds rather than simply react to exact positions.

### Sound Accuracy

The game should classify sounds into different confidence levels.

#### High Confidence

The player can determine the source with high precision.

Examples:

- Nearby explosion
- Gunfire
- Sprinting nearby
- Breaking walls
- Large monsters

Visualization:

- Bright
- Sharp
- Small uncertainty radius
- Clear direction

---

#### Medium Confidence

The player has a good idea where the sound originated, but not its exact position.

Examples:

- Walking
- Opening doors
- Reloading
- Normal conversations

Visualization:

- Slightly blurred
- Medium uncertainty radius
- Slight directional ambiguity

---

#### Low Confidence

The player only knows that "something" produced a sound somewhere nearby.

Examples:

- Sneaking
- Soft footsteps
- Rustling
- Suppressed equipment
- Sounds travelling through several walls

Visualization:

- Diffuse ripple
- Large uncertainty radius
- Weak intensity
- Direction may be partially obscured

### Environmental Effects

The environment should significantly influence sound propagation.

Examples:

- Thick stone walls absorb sound.
- Wooden walls allow more sound through.
- Metal structures may resonate.
- Large open halls amplify sound.
- Narrow corridors funnel sound further.
- Water may distort or dampen sound.
- Open doorways allow sound to travel with minimal attenuation.

Players should learn to use the environment strategically.

### Equipment Interaction

Equipment can influence both emitted and received sound.

Examples:

#### Sound Reduction

- Soft-soled boots
- Cloaking devices
- Sound dampeners
- Lightweight armor

These reduce the sound emitted by movement and actions.

#### Sound Amplification

- Heavy armor
- Large backpacks
- Damaged equipment
- Sprinting
- Carrying heavy objects

These increase emitted sound.

#### Detection Equipment

Some equipment improves perception instead of reducing noise.

Examples:

- Acoustic amplifiers
- Sonar scanners
- Motion detectors
- Echolocation devices

These should improve the player's interpretation of sounds without revealing exact positions unless specifically intended.

### Artificial Sounds

Players should be able to intentionally manipulate what others hear.

Possible mechanics include:

- Throwable noise makers
- Timed sound emitters
- Fake footsteps
- Alarm devices
- Decoys
- Remote explosives
- Mechanical distractions

Creating false information should be just as powerful as gathering real information.

### Gameplay Philosophy

Sound should never function as a wallhack.

Instead, it should provide clues that skilled players learn to interpret.

The uncertainty surrounding sound is intentional and should reward experience, communication, and tactical decision-making rather than reflexive reactions.

# Architecture

The project should follow a clean separation between simulation and presentation.

The game should be deterministic wherever practical.

Recommended architecture:

Presentation Layer

- PixiJS
- UI
- Particle effects
- Sound playback
- Input

↓

Gameplay Layer

Entity Component System (ECS)

↓

Networking Layer

Prediction
Interpolation
Replication
Authority

↓

Server Simulation

↓

Persistence

## Entity Component System

Gameplay should **not** be tied directly to rendering objects.

Instead, every gameplay object should exist as an entity composed of components.

Examples:

Entity

Player

Components

- Position
- Velocity
- Health
- Inventory
- Vision
- SoundEmitter
- SoundListener
- Team
- AI
- Equipment

Systems operate on entities.

Example systems:

- MovementSystem
- CollisionSystem
- VisionSystem
- FogOfWarSystem
- SoundPropagationSystem
- AIBehaviorSystem
- WeaponSystem
- InventorySystem
- PhysicsSystem
- NetworkingSystem
- ParticleSystem

Rendering should merely observe ECS state.

The renderer should never own gameplay state.

This separation makes:

- multiplayer synchronization easier
- AI easier
- deterministic simulation possible
- testing easier
- future ports easier
- dedicated servers simpler
- replay systems feasible

The preferred implementation is BiteCS, although a custom ECS implementation is acceptable if it remains simple, deterministic and well documented.

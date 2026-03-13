# plugin-install Specification (Delta)

## Purpose
Generalize the init plugin installation flow to support adapter-specific installation strategies, enabling both Claude and Cursor (and future adapters) to install plugins through their own mechanisms.

## MODIFIED Requirements

### Requirement: Plugin installation with scope

The `init` command SHALL support plugin installation for any adapter that provides a plugin install mechanism. Each adapter SHALL define its own installation strategy (e.g., CLI commands, local file copy). The init flow SHALL prompt for scope (user/project), delegate to the adapter's install mechanism, and handle success/failure uniformly.

#### Scenario: Adapter-specific installation dispatched
- **WHEN** the user selects a development CLI that supports plugin installation
- **THEN** init SHALL delegate to that adapter's installation strategy with the selected scope

#### Scenario: Already-installed detection
- **WHEN** the plugin is already installed for the selected adapter at any scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

#### Scenario: Installation failure
- **WHEN** the adapter's installation strategy fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print adapter-specific manual installation instructions
- **AND** SHALL continue with remaining init steps

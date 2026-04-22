# @kopai/cli

## 0.9.3

### Patch Changes

- 97124e9: Defaulted the CLI API URL to the hosted Kopai endpoint (https://api.kopai.app/v2) so `kopai login` and query commands work against kopai.app without `--url`.

## 0.9.2

### Patch Changes

- Updated dependencies [0ec5875]
  - @kopai/sdk@0.8.0

## 0.9.1

### Patch Changes

- Updated dependencies [b88c36f]
  - @kopai/core@0.10.0
  - @kopai/sdk@0.7.1

## 0.9.0

### Minor Changes

- 3894c34: Add aggregate metrics

### Patch Changes

- Updated dependencies [3894c34]
  - @kopai/core@0.9.0
  - @kopai/sdk@0.7.0

## 0.8.2

### Patch Changes

- Updated dependencies [5aea6c3]
  - @kopai/core@0.8.0
  - @kopai/sdk@0.6.0

## 0.8.1

### Patch Changes

- Updated dependencies [3bf6838]
  - @kopai/sdk@0.5.0

## 0.8.0

### Minor Changes

- 593e7ea: Check for updates. Warn if not at latest version

## 0.7.0

### Minor Changes

- 4731538: Move `/signals` prefix from baseUrl into SDK paths. baseUrl is now the server root (e.g. `http://localhost:8000`). CLI `--url` flag and config now point to server root. Dashboard schema fetch includes auth header.
- 4731538: Add dynamic dashboard

### Patch Changes

- Updated dependencies [4731538]
- Updated dependencies [4731538]
  - @kopai/sdk@0.4.0
  - @kopai/core@0.7.0

## 0.6.0

### Minor Changes

- 1aa5992: Add login-related commands

## 0.5.3

### Patch Changes

- Updated dependencies [56f9607]
  - @kopai/core@0.6.0
  - @kopai/sdk@0.3.1

## 0.5.2

### Patch Changes

- 94f2112: Promote --url, --token, --config, --timeout to top-level and all subcommands; add usage examples to --help

## 0.5.1

### Patch Changes

- Updated dependencies [21ad97d]
  - @kopai/sdk@0.3.0

## 0.5.0

### Minor Changes

- 20dcacc: Cosmetic improvements for CLI startup

## 0.4.0

### Minor Changes

- acd7540: Add ui package

## 0.3.3

### Patch Changes

- Updated dependencies [853f95e]
  - @kopai/core@0.5.0
  - @kopai/sdk@0.2.3

## 0.3.2

### Patch Changes

- Updated dependencies [c9fe7a3]
  - @kopai/core@0.4.0
  - @kopai/sdk@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [03ebb7d]
  - @kopai/core@0.3.0
  - @kopai/sdk@0.2.1

## 0.3.0

### Minor Changes

- 4508492: Unstuck publish

## 0.2.0

### Minor Changes

- 1da61f2: Publish all on same version

### Patch Changes

- Updated dependencies [1da61f2]
  - @kopai/core@0.2.0
  - @kopai/sdk@0.2.0

## 0.1.0

### Minor Changes

- b5074c3: Initial provenance publish for dependencies

### Patch Changes

- Updated dependencies [b5074c3]
  - @kopai/core@0.1.0
  - @kopai/sdk@0.1.0

## 0.0.1

### Patch Changes

- c3d4ac5: initial publish

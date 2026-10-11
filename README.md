# Monge Settings

A GNOME Settings with extra features and fixes

## Target GNOME Shell Version

Monge Settings currently requires the **GNOME Shell 49.4** runtime it was validated against. Porting to another GNOME release requires updating and retesting the retained helper resources and native integration.

Only selected **GNOME Shell** releases are targeted:

| Monge Settings | Validated against GNOME Shell |
| --- | --- |
| [v49.5](../../tree/49.5) | v49.4 |

Note: Monge Settings's version matches the **GNOME Settings** version it is based on. **GNOME Settings** and **GNOME Shell** are separate components whose versions don't need to match exactly.

## Repository layout

- `panels/extensions/vendor/`: retained GNOME Shell helper sources.
- `tests/extensions/`: automated tests.
- `scripts/`: helper resource build tool.
- `build/`: generated helper resources; not committed.

## Credits

- **GNOME Settings (`gnome-control-center`)** provide the upstream application and native Settings interface on which this fork is based.
- **[mjakeman's Extension Manager](https://github.com/mjakeman/extension-manager)** heavily inspired the Extensions section, including the Installed/Browse organization and extension-management layout.

Inherited code retains its original copyright and license notices. The upstream GPLv2 license document is preserved in [COPYING](COPYING); the retained helper's license is in `panels/extensions/vendor/COPYING`.

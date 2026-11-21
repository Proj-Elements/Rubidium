# Third-Party Notices

Rubidium's own source code is licensed under GNU AGPL version 3 only. This does not replace or change the license of any third-party dependency, font, icon, or asset. Redistributed copies must retain the applicable upstream notices and satisfy each component's license independently.

The production dependency tree was inspected with `pnpm licenses list --prod --json`. It contains packages under Apache-2.0, MIT, ISC, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, 0BSD, CC-BY-4.0, OFL-1.1, and combined MIT/Apache or MIT/ISC/BSD terms. Versions are pinned in `pnpm-lock.yaml`; package-level copyright and full license texts remain with their respective upstream packages.

## Notable Dependencies

- `@heroui/react` and `@heroui/styles` are Apache-2.0.
- `@modelcontextprotocol/sdk` is MIT.
- `@fontsource-variable/manrope` is OFL-1.1. Its font binaries remain subject to the SIL Open Font License and must not be redistributed separately from their required notices.
- `@heroui-pro/react` is not covered by Rubidium's AGPL grant. It carries a separate HeroUI Pro license in the installed package; installation and use require a valid active HeroUI Pro license. The HeroUI Pro terms permit publishing and distributing applications built with the package, while prohibiting redistribution of the package itself. Build credentials are supplied only as BuildKit secrets.
- The `heroui-pro` setup CLI reports `UNLICENSED` in the package inventory. It is used by the Pro installation chain; verify the standalone runtime image does not contain or redistribute the CLI package before publishing a release image.

Regenerate and review the dependency inventory after changing dependencies:

```bash
pnpm licenses list --prod --long
pnpm licenses list --prod --json
```

This notice is not a substitute for the upstream license texts or legal advice. The authoritative license for each dependency is the license distributed by that dependency's publisher.

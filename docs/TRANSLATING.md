# Translating the launcher

Translations use [Tolgee Cloud](https://app.tolgee.io/) and flat
[i18next JSON](https://docs.tolgee.io/platform/formats/i18next_json).
English is the source language. Translation files live in `assets/locales/`.

Translate launcher navigation, buttons, accessibility labels, setup instructions,
notifications and ordinary user-facing messages. Keep product names, command
examples and technical identifiers intact. Do not translate raw logs, diagnostic
reports, protocol fields, error codes, game descriptions or private chat messages.
Never upload account data or private screenshots to the translation project.

## Tolgee project setup

1. Create a project with English (`en`) as its base language and add target languages.
2. Import `assets/locales/en.json` as **i18next JSON**, not native Tolgee JSON.
3. For community contributions, enable a public project and translation suggestions
   in Tolgee. Share the project's public link. Maintainers review suggestions before
   accepting them. See [Tolgee's community guide](https://docs.tolgee.io/platform/translation_process/community-translation).
4. Export accepted, reviewed translations as **i18next JSON**, with flat keys and
   i18next placeholders. Omit untranslated or empty values. Do not export ICU or
   nested JSON directly into the launcher.

Tolgee can convert placeholders for its editor. The exported files must restore
`{{name}}` syntax and i18next plural suffixes such as `_one`, `_few` and `_other`.
Preserve every parameter's name, but reorder parameters as needed. The launcher
renders plain text only; HTML, rich-text tags and nested translation references
are not supported.

## Updating translation files

After `npm ci`, validate the catalogue:

```sh
npm run i18n:check
```

To prepare files for Tolgee, export into a new directory:

```sh
npm run i18n:export -- /tmp/nexus-tolgee-export
```

Import a reviewed target-language export, using its canonical language tag:

```sh
npm run i18n:import -- cs /absolute/path/to/cs.json
npm run i18n:check
npm run typecheck
npm test
```

Import checks unknown keys, missing or changed parameters, invalid syntax,
duplicate keys and unsupported markup. It cannot determine translation quality
or verify Tolgee review status, so review the export and Git diff before merging.
Do not rename keys just to improve their wording. Add new UI text with a stable,
descriptive key and an English entry. Keep complete sentences together, with named
parameters instead of joining translated fragments. Add the language's plural
forms where required.

Translations are bundled with the launcher, with no Tolgee API key or network
dependency at startup. Imported languages appear automatically in **Settings →
Interface language**. System default selects an available language; missing keys
and unsupported languages fall back to English. This preference does not change
game languages or the Store region. Raw technical errors may remain in English.

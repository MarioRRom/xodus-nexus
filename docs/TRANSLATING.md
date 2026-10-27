# Translating the launcher

Translations use the [Xodus Nexus Tolgee project](https://app.tolgee.io/projects/36162) and flat
[i18next JSON](https://docs.tolgee.io/platform/formats/i18next_json).
English is the source language. Translation files live in `assets/locales/`.

Translate launcher navigation, buttons, accessibility labels, setup instructions,
notifications and ordinary user-facing messages. Keep product names, command
examples and technical identifiers intact. Do not translate raw logs, diagnostic
reports, protocol fields, error codes, game descriptions or private chat messages.
Never upload account data or private screenshots to the translation project.

## Tolgee project setup

1. English (`en`) is the base language. Add target languages when contributors
   volunteer to translate them; no preferred-language order is required.
   If your language is not listed, request it in a GitHub issue so a maintainer
   can add it to the project.
2. Import `assets/locales/en.json` as **i18next JSON**, not native Tolgee JSON.
3. For community contributions, enable a public project and translation suggestions
   in Tolgee. Share the project's public link. Suggestions can be accepted by a
   maintainer or the checked batch tool described below. See
   [Tolgee's community guide](https://docs.tolgee.io/platform/translation_process/community-translation).
4. Export accepted, reviewed translations as **i18next JSON**, with flat keys and
   i18next placeholders. Omit untranslated or empty values. Do not export ICU or
   nested JSON directly into the launcher.

Tolgee can convert placeholders for its editor. The exported files must restore
`{{name}}` syntax and i18next plural suffixes such as `_one`, `_few` and `_other`.
Preserve every parameter's name, but reorder parameters as needed. The launcher
renders plain text only; HTML, rich-text tags and nested translation references
are not supported.

## Updating translation files

### GitHub source synchronization

The **Sync English UI to Tolgee** workflow uploads new and changed English strings
after `assets/locales/en.json` changes on `main`. It can also be run manually on
`main`. It does not run for pull requests, compile an application or publish a
release. The source of truth for English remains Git, not the Tolgee editor.

Configure the repository Actions secret `TOLGEE_SOURCE_API_KEY` with a project API
key restricted to project **36162** and the permissions needed to view/import
strings, create/edit keys and update English translations. Do not grant key
deletion, project administration or account-wide access. Keep credentials out of
configuration files, issues and application bundles. Workflow credentials are
exposed only to the upload step, never package installation.

The checked-in configuration uploads only `assets/locales/en.json`, not target
translations, screenshots or other files. It updates existing English entries
without deleting remote keys or overwriting community target translations.
Removed source keys require a separate maintainer cleanup after review.

### Batch acceptance of community suggestions

The **Accept checked translation suggestions** workflow runs manually on `main`.
Choose `preview`, `accept`, or `accept-and-review`, optionally limiting the target
languages (for example `fr,es`). One run processes all eligible suggestions and
produces a report of accepted and skipped keys. It does not build, publish, merge
or change bundled translation files.

Configure a separate `TOLGEE_REVIEW_API_KEY` repository secret, restricted to
project **36162**, with `keys.view`, `translations.view`, `translations.edit` and
`translations.state-edit`. Restrict editing and state changes to target languages
where the credential supports language restrictions. No deletion, administration,
screenshots or account-wide access is needed. Never reuse the source-upload key.

The tool accepts only a single active suggestion into an empty target translation.
It checks the English source against Git, parameter occurrences, protected product
names and URLs, plain-text syntax, script compatibility, formatting and length.
English, existing translations, plurals, conflicting suggestions, unresolved
comments and unsupported cases are left untouched. Contributor attribution stays
in Tolgee; competing suggestions are not declined or deleted.

These are **technical checks, not a linguistic review**. A valid sentence can
still have incorrect meaning, grammar or even the wrong Latin-script language.
`accept-and-review` marks eligible entries `REVIEWED` for export based on this
technical policy. Choose `accept` if a language reviewer should check them first.
Avoid editing the same entries while the batch runs: Tolgee's accept API has no
atomic compare-and-set guard. The tool rechecks immediately before acceptance,
verifies the result and stops on errors without retrying uncertain writes.

For local use, supply the key through a private environment, not a command line
or a committed file:

```sh
npm run i18n:accept -- --languages fr
npm run i18n:accept -- --languages fr --apply --reviewed
```

The first command previews without writes. The second accepts eligible French
suggestions and marks them reviewed. Reports contain key names, language tags and
outcomes, not credentials, contributor identifiers or translation text.

### Reviewed translations back into Git

Install dependencies, then authorize the official CLI in your browser:

```sh
npm exec -- tolgee login
npm run i18n:pull
```

The pull command exports only **REVIEWED** strings as flat i18next JSON into a
fresh temporary directory and prints its path. It validates the downloaded
catalogues without changing `assets/locales/`. Each pull uses a separate directory
so removed or unreviewed entries cannot remain from an earlier export.

Import the desired target files with the command below, inspect the diff and
submit a translation PR to `develop`. Integrate `develop` into `main` through the
normal separate PR. Builds use only the committed files, never a live Tolgee
download. No Tolgee credential is needed to build or run the launcher.

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

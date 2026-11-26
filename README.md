# Paperdesk

**Read papers, check the evidence, and stress-test your research.**

Paperdesk is a local research workspace for reading PDFs alongside an AI assistant. Click a page citation to jump to the passage, compare studies, or ask for a journal-style review of your own manuscript.

## Quick start

1. Install [Node.js 24 LTS](https://nodejs.org/) and download or clone this repository.
2. Open a terminal in the Paperdesk folder and run:

   ```sh
   npm ci --omit=optional
   npm start
   ```

3. Open [http://127.0.0.1:47653](http://127.0.0.1:47653) and try the built-in synthetic example or add your own PDF.

On Windows, `START.cmd` launches Paperdesk once the assets are installed. If you have the bundled Windows ZIP, extract it and run `START.cmd` directly. Keep the server terminal open while using the app. Use the same browser profile and local address to return to your library.

## What you can do

| Workflow | Features |
| --- | --- |
| Read and organize | Import or drop PDFs, create folders, tag papers, track reading status, search text, save bookmarks and excerpts, and recover papers from Trash. |
| Ask with evidence | Chat about a paper or selected passage. Open citations in the PDF and inspect the excerpts that went into the model request. |
| Analyze and compare | Extract study characteristics, assess methods and statistics, and compare up to six PDFs with document and page citations. Export supported tables to CSV. |
| Plan and review | Develop research hypotheses, challenge study designs, and get reviewer feedback with publication blockers, evidence, and revision priorities. |
| Search and verify | Run a scoped Hyperresearch search across Europe PMC and Crossref, resolve DOIs against Crossref, and export records to RIS. |
| Write and revise | Outline an IMRaD manuscript, draft a section using supplied findings, plan responses to reviewers, and hand reports to optional ARS-Codex workflows. |

Press **Ctrl+K** to search the library, **Ctrl+F** to search the open PDF, and **Enter** to send a question. Use **Shift+Enter** for a new line.

## AI connection

- **Codex CLI.** Install or sign in to [Codex CLI](https://developers.openai.com/codex/cli), then select **Codex** in Paperdesk Settings. Set `PAPERDESK_CODEX_BIN` to the executable path if auto-detection misses it.
- **OpenAI API.** Choose **OpenAI Responses API** and enter your key in Settings, or set `OPENAI_API_KEY` before starting the app. A key entered in Settings stays in server memory until the app closes. API usage is billed by OpenAI.
- **Model selection.** Routine questions and extraction use GPT-6.2 Sol with High reasoning. Deep analysis, complex comparisons, and reviewer questions use Astra. Dedicated research strategy and reviewer workflows use Astra at Extra high. The chat composer offers **Review with Astra** for the next request. Responses show the model and effort used. Your selected provider needs access to the requested models.

## Data and evidence

- The server listens on localhost. The browser stores the library, PDFs, notes, and chats in IndexedDB. PDF reading and library organization work offline after setup.
- AI requests send the question and relevant excerpts to the configured provider. Optional ARS runs can use explicitly attached files and store job inputs and outputs in the local Paperdesk data folder. The folder is `%LOCALAPPDATA%\Paperdesk` on Windows and can be overridden with `PAPERDESK_DATA`.
- Literature searches send search terms to Europe PMC and Crossref. DOI checks verify registration and metadata. Inspect the cited passages and the scope of the search before relying on an AI-generated finding.
- Analysis uses the PDF text layer. Image-only scans need OCR before import. Figures, tables, and equations may lose structure during extraction.

## Optional ARS-Codex workflows

Under **Settings → ARS-Codex workflows**, install the pinned upstream revision with Git. The **Workflows** tab can run literature research, manuscript, peer-review, disclosure, academic pipeline, and researcher profiles. This integration requires Codex CLI. It runs the selected workflow inside Paperdesk's configured model and job directory. Stages that depend on independent agents or external utilities may require the upstream runtime.

## Credits

- [Imbad0202/academic-research-skills-codex](https://github.com/Imbad0202/academic-research-skills-codex/tree/d300ddcccb3d0de6ea76c27b41b1c3da775e3d4b) powers the optional ARS integration.
- [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) 5.6.205 renders PDFs. Its Apache 2.0 license is copied to `vendor/LICENSE` during setup.
- [Pretendard Variable](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9) 1.3.9 is distributed under the SIL Open Font License 1.1, copied to `vendor/pretendard/LICENSE.txt` during setup.

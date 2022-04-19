import * as vscode from 'vscode';
import * as yaml from "js-yaml";
import {
  setContext,
  activePreview,
  idToInfo,
  idToPreview,
  openPreviews,
  setLockedPreviews,
  lockedPreviews,
  initInfo,
  basename,
} from "./global";
import {
  genHtml,
  genTitle,
  createPreviewPanel,
  previewInfo,
} from "./components/preview";
import {
  setListeners,
  setTabChangeListener,
  unsetTabChangeListener,
} from "./components/listeners";
import { parsePageData, serveBackend } from "./components/source";
import * as wikidot from './wikidot';
import WikidotAuthProvider from './WikidotAuthProvider';

export function activate(context: vscode.ExtensionContext) {
  setContext(context);
  initInfo();
  setLockedPreviews(context.workspaceState.get('ftml.lockedPreviews'));
  let WdAuthProvider = new WikidotAuthProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('ftml.preview', {
      async deserializeWebviewPanel(webviewEditor: vscode.WebviewPanel, state: previewInfo) {
        openPreviews.add(state.id);
        idToPreview.set(state.id, webviewEditor);
        idToInfo.set(state.id, state);
        webviewEditor.webview.html = genHtml(state);
        setListeners(webviewEditor, state.id);
      }
    }),

    vscode.commands.registerCommand('ftml.preview.open', () => {
      createPreviewPanel();
    }),

    vscode.commands.registerCommand('ftml.preview.openToSide', () => {
      createPreviewPanel(vscode.ViewColumn.Beside);
    }),

    vscode.commands.registerCommand('ftml.preview.toggleLock', () => {
      if (activePreview) {
        let panel = idToPreview.get(activePreview)!;
        let panelInfo = idToInfo.get(activePreview)!;
        if (lockedPreviews.has(activePreview)) {
          setTabChangeListener(panel, activePreview);
          panel.title = genTitle(
            basename(panelInfo.fileName),
            panelInfo.backend,
            panelInfo.live,
            lockedPreviews.has(activePreview));
        } else {
          unsetTabChangeListener(panel, activePreview);
          panel.title = genTitle(
            basename(panelInfo.fileName),
            panelInfo.backend,
            panelInfo.live,
            lockedPreviews.has(activePreview));
        }
      }
    }),

    vscode.commands.registerCommand('ftml.preview.toggleLive', () => {
      if (activePreview) {
        let panel = idToPreview.get(activePreview)!;
        let panelInfo = idToInfo.get(activePreview)!;
        panelInfo.live = !panelInfo.live;
        panel.webview.postMessage({
          type: "meta.live",
          live: panelInfo.live,
        })
        panel.title = genTitle(
          basename(panelInfo.fileName),
          panelInfo.backend,
          panelInfo.live,
          lockedPreviews.has(activePreview));
      }
    }),

    vscode.commands.registerCommand('ftml.preview.toggleBackend', () => {
      if (activePreview) {
        let panel = idToPreview.get(activePreview)!;
        let panelInfo = idToInfo.get(activePreview)!;
        panelInfo.backend = panelInfo.backend == 'ftml' ? 'wikidot' : 'ftml';
        panel.webview.postMessage({
          type: "meta.backend",
          backend: panelInfo.backend,
        })
        panel.title = genTitle(
          basename(panelInfo.fileName),
          panelInfo.backend,
          panelInfo.live,
          lockedPreviews.has(activePreview));
        vscode.commands.executeCommand('setContext', 'ftmlPreviewBackend', panelInfo.backend);
        vscode.commands.executeCommand('ftml.preview.refresh');
      }
    }),

    vscode.commands.registerCommand('ftml.preview.refresh', () => {
      if (activePreview) {
        let panel = idToPreview.get(activePreview)!;
        let panelInfo = idToInfo.get(activePreview)!
        let td = vscode.workspace.textDocuments.find(doc=>doc.fileName==panelInfo.fileName);
        if (td) {
          serveBackend(panel,
            td.fileName,
            td.getText(),
            panelInfo.backend);
        }
      }
    }),

    vscode.commands.registerCommand('ftml.remote.wikidot.login', () => {
      WdAuthProvider.createSession().catch(e=>{
        if (e instanceof Error) {
          vscode.window.showErrorMessage(e.toString());
        }
      });
    }),

    vscode.commands.registerCommand('ftml.remote.wikidot.fetch', () => {
      let activeEditor = vscode.window.activeTextEditor;
      if (activeEditor?.document.languageId == "ftml") {
        vscode.authentication.getSession('wikidot', [], {
          clearSessionPreference: true,
          createIfNone: true,
        }).then(sess=>{
          let data = parsePageData(activeEditor!.document.getText());
          if (!data.page) data.page = basename(activeEditor!.document.fileName).split('.')[0];
          vscode.window.withProgress({
            cancellable: false,
            location: vscode.ProgressLocation.Notification
          }, async (prog)=>{
            prog.report({message: `Fetching page ${data.page} from ${data.site}...`});
            let fetched = await wikidot.Page.getMetadata({
              wikiSite: data.site,
              wikiPage: data.page,
              session: sess.accessToken})
            if (fetched.revision === undefined) {
              vscode.window.showInformationMessage(`The remote page ${data.page} does not exist on site ${data.site}.`);
              return;
            };
            if (data.revision === undefined || data.revision < fetched.revision) {
              let answer = await vscode.window.showWarningMessage(`The remote page ${data.page} has a revision newer than the local copy. Overwrite local copy?`, "Yes", "No");
              if (answer != "Yes") return;
            } else if (data.revision !== undefined && data.revision >= fetched.revision) {
              vscode.window.showInformationMessage(`Your local copy of ${data.page} is already at the latest version.`);
              return;
            };
            for (const key in data) {
              if (key!="source" && !Object.prototype.hasOwnProperty.call(fetched, key)) { fetched[key] = data[key]; }
            }
            let source = await wikidot.Page.getSource(data.site, data.page);
            await activeEditor!.edit(builder=>{
              builder.delete(activeEditor!.document.lineAt(activeEditor!.document.lineCount-1).rangeIncludingLineBreak
                  .union(new vscode.Range(0,0,activeEditor!.document.lineCount-1,0)))
              builder.insert(new vscode.Position(0,0), `---\n${yaml.dump(fetched)}---\n${source}`);
            })
          })
        }).catch(e=>{
          if (e instanceof Error) {
            vscode.window.showErrorMessage(e.toString());
          }
        });
      }
    }),

    vscode.commands.registerCommand('ftml.remote.wikidot.push', () => {
      let activeEditor = vscode.window.activeTextEditor;
      if (activeEditor?.document.languageId == "ftml") {
        vscode.authentication.getSession('wikidot', [], {
          clearSessionPreference: true,
          createIfNone: true
        }).then(async sess=>{
          let data = parsePageData(activeEditor!.document.getText());
          vscode.window.withProgress({
            cancellable: false,
            location: vscode.ProgressLocation.Notification
          }, async (prog)=>{
            prog.report({message: `Pushing to page ${data.page} on ${data.site}...`});
            try {
              let fetched = await wikidot.Page.getMetadata({
                wikiSite: data.site,
                wikiPage: data.page,
                session: sess.accessToken})
              if (data.revision !== undefined && fetched.revision !== undefined && data.revision < fetched.revision) {
                let answer = await vscode.window.showWarningMessage(`The remote page ${data.page} has a revision newer than the local copy. Overwrite remote page?`, "Yes", "No");
                if (answer != "Yes") return;
              }
              await wikidot.Page.edit({
                wikiSite: data.site,
                wikiPage: data.page,
                session: sess.accessToken, }, {
                  ...data,
                  parentPage: data.parent,
                })
            } catch (e) {
              if (e.src?.status == "not_ok") {
                // Wikidot now dies when new page is created with tags in its options
                // Redo edit with seperate processing of page creation and tags
                let tags = data.tags;
                delete data.tags;
                await new Promise(res=>setTimeout(res, 3000));
                await wikidot.Page.edit({
                  wikiSite: data.site,
                  wikiPage: data.page,
                  session: sess.accessToken, }, {
                    ...data,
                    parentPage: data.parent,
                  });
                await new Promise(res=>setTimeout(res, 3000));
                await wikidot.Page.edit({
                  wikiSite: data.site,
                  wikiPage: data.page,
                  session: sess.accessToken, }, {
                  ...data,
                  parentPage: data.parent,
                  tags
                })
              } else {
                if (typeof e.src?.status == 'number') {
                  if (e.src.status != 500) {
                    vscode.window.showErrorMessage(`Error code ${e.src.status}`)
                  }
                } else vscode.window.showErrorMessage(`${e.src?.status}: ${e.message}`);
                return;
              }
            } finally {
              await new Promise(res=>setTimeout(res, 3000));
              let fetched = await wikidot.Page.getMetadata({
                wikiSite: data.site,
                wikiPage: data.page,
                session: sess.accessToken});
              for (const key in data) {
                if (key!="source" && !Object.prototype.hasOwnProperty.call(fetched, key)) { fetched[key] = data[key]; }
              }
              await activeEditor!.edit(builder=>{
                builder.delete(activeEditor!.document.lineAt(activeEditor!.document.lineCount-1).rangeIncludingLineBreak
                    .union(new vscode.Range(0,0,activeEditor!.document.lineCount-1,0)))
                builder.insert(new vscode.Position(0,0), `---\n${yaml.dump(fetched)}---\n${data.source}`);
              })
            }
          })
        }).catch(e=>{
          if (e instanceof Error) {
            vscode.window.showErrorMessage(e.toString());
          }
        });
      }
    }),

    vscode.authentication.registerAuthenticationProvider(
      'wikidot',
      'Wikidot',
      WdAuthProvider,
      { supportsMultipleAccounts: true }),
  );
}
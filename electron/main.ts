import { app, BrowserWindow, dialog, Menu, MenuItemConstructorOptions, nativeTheme, session, shell } from "electron";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const APP_NAME = "Kotoba";
app.setName(APP_NAME); // keeps the settings folder at %APPDATA%\Kotoba, whether packaged or not
app.setAppUserModelId("com.kotoba.translator"); // lets Windows group the taskbar icon and use the right name

const ENV_TEMPLATE = `# Kotoba settings. Save this file, then restart the app.

# Optional: turns on the "Advanced" translation option (uses the Claude API, billed per use).
ANTHROPIC_API_KEY=

# Optional: a Google Cloud Translation key, used by the "Normal" option when it is set.
GOOGLE_API_KEY=
`;

let mainWindow: BrowserWindow | null = null;
let origin = "";

const envFile = (): string => path.join(app.getPath("userData"), ".env");

// A free port on this computer, so the app never clashes with anything else that is running.
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address() as net.AddressInfo;
            probe.close(() => resolve(port));
        });
    });
}

async function waitForServer(port: number): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) return;
        } catch {
            /* not listening yet */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The translation server did not start.");
}

// The translation server runs inside this program, reachable only from this computer.
async function startServer(): Promise<number> {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    if (!fs.existsSync(envFile())) fs.writeFileSync(envFile(), ENV_TEMPLATE, "utf8");
    const port = await freePort();
    process.env.PORT = String(port);
    process.env.HOST = "127.0.0.1";
    process.env.DOTENV_CONFIG_PATH = envFile();
    require(path.join(__dirname, "..", "dist", "server.js"));
    await waitForServer(port);
    return port;
}

function buildMenu(): void {
    const view: MenuItemConstructorOptions[] = [
        { role: "reload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
    ];
    if (!app.isPackaged) view.push({ type: "separator" }, { role: "toggleDevTools" });
    const template: MenuItemConstructorOptions[] = [
        {
            label: APP_NAME,
            submenu: [
                { label: "Open settings file (.env)", click: () => void shell.openPath(envFile()) },
                { label: "Open data folder", click: () => void shell.openPath(app.getPath("userData")) },
                { type: "separator" },
                { role: "quit" },
            ],
        },
        { role: "editMenu" },
        { label: "View", submenu: view },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port: number): BrowserWindow {
    origin = `http://127.0.0.1:${port}`;
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 820,
        minHeight: 600,
        show: false, // shown once the page is ready, so there is no white flash
        autoHideMenuBar: true, // press Alt to show the menu
        title: APP_NAME,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#131314" : "#ffffff",
        icon: path.join(__dirname, "..", "build", "icon.png"),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    // The page can tell it is running in the desktop app (the speech service is not available here).
    win.webContents.setUserAgent(`${win.webContents.getUserAgent()} KotobaDesktop/${app.getVersion()}`);

    win.once("ready-to-show", () => win.show());

    // Links to other sites open in the normal browser. A translated PDF (a blob: address) opens in its own window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("blob:")) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: { width: 1000, height: 900, autoHideMenuBar: true, webPreferences: { plugins: true } },
            };
        }
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith(origin)) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });

    // Right-click menu for the text boxes (cut, copy, paste).
    win.webContents.on("context-menu", (_event, params) => {
        const items: MenuItemConstructorOptions[] = [];
        if (params.isEditable) {
            items.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
        } else if (params.selectionText) {
            items.push({ role: "copy" });
        }
        if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win });
    });

    win.on("closed", () => {
        mainWindow = null;
    });
    void win.loadURL(`${origin}/`);
    return win;
}

if (!app.requestSingleInstanceLock()) {
    app.quit(); // already running: the first copy comes to the front instead
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        try {
            session.defaultSession.setPermissionRequestHandler((_wc, permission, allow) => allow(permission === "clipboard-sanitized-write"));
            buildMenu();
            mainWindow = createWindow(await startServer());
        } catch (err) {
            dialog.showErrorBox(`${APP_NAME} could not start`, err instanceof Error ? err.message : String(err));
            app.quit();
        }
    });

    app.on("window-all-closed", () => app.quit());
}
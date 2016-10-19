﻿module BABYLON.EDITOR {
    export interface IPostProcessBuilderData extends EDITOR.EXTENSIONS.IPostProcessExtensionData {
        editorPostProcess?: PostProcess;
    }

    interface IPostProcessGridItem extends GUI.IGridRowData {
        name: string;
    }

    export class PostProcessBuilder implements ITabApplication, IEventReceiver {
        // Public members

        // Private members
        private _core: EditorCore;

        private _engine: Engine = null;
        private _scene: Scene = null;
        private _camera: Camera = null;
        private _texture: Texture = null;
        private _scenePassPostProcess: PostProcess = null;

        private _containerElement: JQuery = null;
        private _containerID: string = null;
        private _tab: GUI.IGUITab = null;

        private _layouts: GUI.GUILayout = null;
        private _mainPanel: GUI.GUIPanel = null;
        private _postProcessesList: GUI.GUIGrid<IPostProcessGridItem> = null;

        private _glslTabId: string = null;
        private _configurationTabId: string = null;
        private _currentTabId: string = null;

        private _selectTemplateWindow: GUI.GUIWindow = null;

        private _editor: AceAjax.Editor = null;
        private _console: AceAjax.Editor = null;

        private _datas: IPostProcessBuilderData[];
        private _currentSelected: number = 0;

        private _extension: EDITOR.EXTENSIONS.PostProcessBuilderExtension;
        private _mainExtension: EDITOR.EXTENSIONS.PostProcessBuilderExtension;

        // Static members
        public static _ConfigurationFileContent: string = null;

        /**
        * Constructor
        * @param core: the editor core
        */
        constructor(core: EditorCore) {
            // Configure this
            this._core = core;
            core.eventReceivers.push(this);

            // Finalize
            this._getConfigurationFile(() => {
                // Metadatas
                this._datas = SceneManager.GetCustomMetadata<IPostProcessBuilderData[]>("PostProcessBuilder");
                if (!this._datas) {
                    this._datas = [{ name: "NewPostProcess", id: SceneFactory.GenerateUUID(), program: Effect.ShadersStore["passPixelShader"], configuration: PostProcessBuilder._ConfigurationFileContent }];
                    SceneManager.AddCustomMetadata("PostProcessBuilder", this._datas);
                }

                // Create UI
                this._createUI();
                this._onPostProcessSelected([0]);

                // Extensions
                this._extension = new EDITOR.EXTENSIONS.PostProcessBuilderExtension(this._scene);
                this._extension.placeHolderTexture = this._texture;

                this._mainExtension = new EDITOR.EXTENSIONS.PostProcessBuilderExtension(this._core.currentScene);
            });
        }

        /**
        * Disposes the application
        */
        public dispose(): void {
            // Remove post-processes
            for (var i = 0; i < this._datas.length; i++) {
                if (this._datas[i].postProcess) {
                    this._mainExtension.removePostProcess(this._datas[i].postProcess);

                    if (this._datas[i].editorPostProcess)
                        this._extension.removePostProcess(this._datas[i].editorPostProcess);

                    this._datas[i].postProcess = null;
                    this._datas[i].editorPostProcess = null;
                }
            }

            // Finalize dispose
            this._core.removeEventReceiver(this);

            this._postProcessesList.destroy();
            this._editor.destroy();
            this._console.destroy();
            this._layouts.destroy();

            this._engine.dispose();
        }

        /**
        * On event
        */
        public onEvent(event: Event): boolean {
            if (event.eventType === EventType.KEY_EVENT) {
                if (event.keyEvent.control && event.keyEvent.key === "b" && !event.keyEvent.isDown) {
                    this._onApplyPostProcessChain(false);
                }
            }

            return false;
        }

        // Creates the UI
        private _createUI(): void {
            // Create tab and container
            this._containerID = this._core.editor.createContainer();
            this._tab = this._core.editor.createTab("Post-Process Builder", this._containerID, this, true);
            this._containerElement = $("#" + this._containerID);

            // Layout
            this._layouts = new GUI.GUILayout(this._containerID, this._core);
            this._layouts.createPanel("POST-PROCESS-BUILDER-LEFT-PANEL", "left", 300, false).setContent(GUI.GUIElement.CreateElement("div", "POST-PROCESS-BUILDER-EDIT", "width: 100%; height: 100%;"));
            this._layouts.createPanel("POST-PROCESS-BUILDER-MAIN-PANEL", "main", 0, false).setContent(GUI.GUIElement.CreateElement("div", "POST-PROCESS-BUILDER-PROGRAM"));
            this._layouts.createPanel("POST-PROCESS-BUILDER-PREVIEW-PANEL", "preview", 150, true).setContent(GUI.GUIElement.CreateElement("div", "POST-PROCESS-BUILDER-CONSOLE"));
            this._layouts.buildElement(this._containerID);

            this._layouts.on("resize", (event) => {
                this._editor.resize(true);
            });

            this._glslTabId = this._currentTabId = SceneFactory.GenerateUUID();
            this._configurationTabId = SceneFactory.GenerateUUID();

            this._mainPanel = this._layouts.getPanelFromType("main");
            this._mainPanel.createTab({ caption: "GLSL", closable: false, id: this._glslTabId });
            this._mainPanel.createTab({ caption: "Configuration", closable: false, id: this._configurationTabId });
            this._mainPanel.onTabChanged = (id) => this._onTabChanged(id);

            // GUI
            var container = $("#POST-PROCESS-BUILDER-EDIT");
            container.append(GUI.GUIElement.CreateElement("div", "POST-PROCESS-BUILDER-EDIT-LIST", "width: 100%; height: 200px;"));

            // List
            this._postProcessesList = new GUI.GUIGrid<IPostProcessGridItem>("POST-PROCESS-BUILDER-EDIT-LIST", this._core);
            this._postProcessesList.createEditableColumn("name", "name", { type: "string" }, "100%");
            this._postProcessesList.multiSelect = false;
            this._postProcessesList.showAdd = true;
            this._postProcessesList.showDelete = true;
            this._postProcessesList.showOptions = false;
            this._postProcessesList.onClick = (selected) => this._onPostProcessSelected(selected);
            this._postProcessesList.onAdd = () => this._onPostProcessAdd();
            this._postProcessesList.onDelete = (selected) => this._onPostProcessRemove(selected);
            this._postProcessesList.onEditField = (recid, value) => this._onPostProcessEditField(recid, value);
            this._postProcessesList.buildElement("POST-PROCESS-BUILDER-EDIT-LIST");

            for (var i = 0; i < this._datas.length; i++)
                this._postProcessesList.addRecord({ name: this._datas[i].name, recid: i });

            this._postProcessesList.refresh();

            // Canvas
            container.append("<br />");
            container.append("<hr>");
            container.append(GUI.GUIElement.CreateElement("p", SceneFactory.GenerateUUID(), "width: 100%;", "Preview:", false));

            var canvasID = SceneFactory.GenerateUUID();
            container.append(GUI.GUIElement.CreateElement("canvas", canvasID, "width: 100%; height: 300px", null, true));

            this._engine = new Engine(<HTMLCanvasElement>$("#" + canvasID)[0]);
            this._scene = new Scene(this._engine);
            this._camera = new Camera("PostProcessCamera", Vector3.Zero(), this._scene);
            this._texture = new Texture("website/Tests/textures/no_smoke.png", this._scene);
            this._engine.runRenderLoop(() => this._scene.render());

            container.append("<br />");
            container.append("<hr>");
            container.append("<br />");

            // Create build button
            var applyOrderButton = GUI.GUIElement.CreateButton(container, SceneFactory.GenerateUUID(), "Apply Chain (CTRL + B)");
            applyOrderButton.css("width", "100%");
            applyOrderButton.css("position", "absolute");
            applyOrderButton.css("bottom", "10px");
            applyOrderButton.addClass("btn-orange");
            applyOrderButton.click((event) => this._onApplyPostProcessChain(false));

            var applyOnSceneButton = GUI.GUIElement.CreateButton(container, SceneFactory.GenerateUUID(), "Apply On Scene");
            applyOnSceneButton.css("width", "100%");
            applyOnSceneButton.css("position", "absolute");
            applyOnSceneButton.css("bottom", "40px");
            applyOnSceneButton.addClass("btn-red");
            applyOnSceneButton.click((event) => this._onApplyPostProcessChain(true));

            // Editor
            this._editor = ace.edit("POST-PROCESS-BUILDER-PROGRAM");
            this._editor.setTheme("ace/theme/clouds");
            this._editor.getSession().setMode("ace/mode/glsl");
            this._editor.getSession().setValue(Effect.ShadersStore["passPixelShader"]);
            this._editor.getSession().on("change", (e) => this._onEditorChanged());

            // Console
            this._console = ace.edit("POST-PROCESS-BUILDER-CONSOLE");
            this._console.getSession().setValue("Ready.");
            
            BABYLON.Tools.Error = (entry: string) => {
                this._console.getSession().setValue(this._console.getSession().getValue() + "\n" + entry);
            };
        }

        // On tab changed
        private _onTabChanged(id: string): void {
            this._currentTabId = id;

            if (id === this._glslTabId) {
                this._editor.getSession().setMode("ace/mode/glsl");
                this._editor.getSession().setValue(this._datas[this._currentSelected].program);
            }
            else {
                this._editor.getSession().setMode("ace/mode/javascript");
                this._editor.getSession().setValue(this._datas[this._currentSelected].configuration);
            }
        }

        // When the user selects an item
        private _onPostProcessSelected(selected: number[]): void {
            if (selected.length < 1)
                return;

            this._currentSelected = selected[0];
            this._editor.getSession().setValue(this._currentTabId === this._glslTabId ? this._datas[selected[0]].program : this._datas[selected[0]].configuration);
        }

        // When the user adds a new post-process
        private _onPostProcessAdd(): void {
            var inputID = SceneFactory.GenerateUUID();

            // Window
            this._selectTemplateWindow = new GUI.GUIWindow("SELECT-TEMPLATE-WINDOW", this._core, "Select template", GUI.GUIElement.CreateElement("input", inputID, "width: 100%;"), new Vector2(400, 120), ["Select", "Close"]);
            this._selectTemplateWindow.setOnCloseCallback(() => {
                this._selectTemplateWindow.destroy();
            });

            this._selectTemplateWindow.buildElement(null);

            // List
            var items: string[] = [];
            for (var thing in Effect.ShadersStore) {
                if (Effect.ShadersStore[thing].indexOf("textureSampler") !== -1)
                    items.push(thing);
            }

            var list = new GUI.GUIList(inputID, this._core);
            list.renderDrop = true;
            list.items = items;
            list.buildElement(inputID);

            // Events
            this._selectTemplateWindow.onButtonClicked = (buttonId: string) => {
                if (buttonId === "Select") {
                    var selected = list.getValue();
                    var data: IPostProcessBuilderData = { name: selected + this._datas.length, id: SceneFactory.GenerateUUID(), program: Effect.ShadersStore[selected], configuration: PostProcessBuilder._ConfigurationFileContent };

                    this._datas.push(data);
                    this._postProcessesList.addRecord({ name: data.name });
                    this._postProcessesList.refresh();
                }

                this._selectTemplateWindow.close();
            };
        }

        // When the user removes a post-process
        private _onPostProcessRemove(selected: number[]): void {
            var data = this._datas[selected[0]];
            if (data.postProcess)
                this._mainExtension.removePostProcess(data.postProcess);

            if (data.editorPostProcess)
                this._extension.removePostProcess(data.editorPostProcess);

            this._datas.splice(selected[0], 1);
            this._currentSelected = -1;

            this._storeMetadatas();
        }

        // When the user edits a row
        private _onPostProcessEditField(recid: number, value: any): void {
            debugger;
        }

        // When the user modifies a post-process
        private _onEditorChanged(): void {
            if (this._currentSelected >= 0) {
                var value = this._editor.getSession().getValue();

                if (this._currentTabId === this._glslTabId)
                    this._datas[this._currentSelected].program = value;
                else
                    this._datas[this._currentSelected].configuration = value;
            }
        }

        // When the user applies the post-process chain
        private _onApplyPostProcessChain(applyOnScene: boolean): void {
            // Clear logs
            this._console.getSession().setValue("Ready.");

            // Remove post-processes
            for (var i = 0; i < this._datas.length; i++) {
                if (this._datas[i].editorPostProcess) {
                    this._extension.removePostProcess(this._datas[i].editorPostProcess);
                    delete Effect.ShadersStore[this._datas[i].editorPostProcess.name + "PixelShader"];
                    this._datas[i].editorPostProcess = null;
                }

                if (this._datas[i].postProcess) {
                    this._mainExtension.removePostProcess(this._datas[i].postProcess);
                    delete Effect.ShadersStore[this._datas[i].postProcess.name + "PixelShader"];
                    this._datas[i].postProcess = null;
                }
            }

            for (var i = 0; i < this._datas.length; i++) {
                var data = this._datas[i];
                data.id = SceneFactory.GenerateUUID();

                this._extension.applyPostProcess(data);
                data.editorPostProcess = data.postProcess;
                data.postProcess = null;

                if (applyOnScene) {
                    data.id = SceneFactory.GenerateUUID();
                    this._mainExtension.applyPostProcess(data);
                }
            }

            this._storeMetadatas();
        }

        // Stores the datas into the custom metadatas
        private _storeMetadatas(): void {
            var customData: IPostProcessBuilderData[] = [];

            for (var i = 0; i < this._datas.length; i++) {
                var data = this._datas[i];
                customData.push({ name: data.name, id: data.id, program: data.program, configuration: data.configuration, postProcess: null, editorPostProcess: null });
            }

            SceneManager.AddCustomMetadata("PostProcessBuilder", customData);
        }

        // Gets the configuration file
        private _getConfigurationFile(callback: () => void): void {
            if (!PostProcessBuilder._ConfigurationFileContent) {
                this._core.editor.layouts.lockPanel("preview", "Loading...", true);

                BABYLON.Tools.LoadFile("website/resources/template.postprocess.configuration.json", (data: string) => {
                    PostProcessBuilder._ConfigurationFileContent = data;
                    this._core.editor.layouts.unlockPanel("preview");
                    callback();
                });
            }
            else
                callback();
        }
    }
}
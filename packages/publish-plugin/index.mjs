import {EditorPlugin, ui, tools, data, project} from '@wonderlandengine/editor-api';
import {CloudClient} from '@wonderlandcloud/cli';

const STATE_NONE = 0;
const STATE_CONFIRMING = 1;
const STATE_UPLOADING = 2;

const API_URL = 'https://api.wonderlandengine.com';
/* Check action confirmation every 5 seconds */
const POLLING_INTERVAL = 5000;
/* Timeout action confirmation in 60 seconds */
const TIMEOUT_INTERVALS = (60 * 1000) / POLLING_INTERVAL;

export default class PublishPlugin extends EditorPlugin {
    token = '';
    publishedUrl = '';
    projectName = '';
    publiser;

    error = '';

    /* The constructor is called when your plugin is loaded */
    constructor() {
        super();
        this.name = 'Wonderland Cloud - Publish';
        this.state = STATE_NONE;
        this.cancelled = false;
        this.listed = false;
    }

    correctProjectName(input) {
        // Convert the input string to lowercase
        let lowercaseString = input.toLowerCase();
        // Remove all characters except lowercase alphabets, digits, and dashes
        let cleanedString = lowercaseString.replace(/[^a-z0-9-]/g, '');
        // Define the regex pattern
        const regex = /^[a-z](([a-z0-9]-?([a-z0-9])?){0,20}[a-z0-9])$/gm;
        // Validate the cleaned string against the regex pattern
        if (regex.test(cleanedString)) {
            return cleanedString;
        }
        return null; // Return null if the string does not comply
    }
    /* Use this function for drawing UI */
    draw() {
        ui.text(`Publish "${data.settings.project.name}"`);
        ui.separator();

        this.listed = ui.checkbox('Publicly listed', this.listed) ?? this.listed;

        if (this.state === STATE_NONE && ui.button('Publish to Wonderland Pages')) {
            this.error = '';
            const cleanName = this.correctProjectName(data.settings.project.name);
            if (cleanName) {
                this.uploading = STATE_CONFIRMING;
                this.cancelled = false;
                tools
                    .packageProject()
                    .then(async () => {
                        try {
                            const result = await this.publish(cleanName);
                            this.error = '';
                        } catch (e) {
                            console.error(e);
                            this.error = e;
                        }
                    })
                    .finally(() => (this.state = STATE_NONE));
            } else {
                this.error = 'Unable to create a slug from the project name';
            }
        } else if (this.state === STATE_CONFIRMING) {
            ui.text('Confirm in your browser.');
            if (ui.button('Cancel')) {
                this.cancelled = true;
            }
        } else if (this.state === STATE_UPLOADING) {
            ui.text('Uploading deployment.');
        }

        if (this.publishedUrl) {
            ui.separator();
            ui.text(`Published at: ${this.publishedUrl}`);
            if (ui.button('Open')) {
                tools.openBrowser(`https://${this.publishedUrl}`);
            }
        }

        if (this.error) {
            ui.separator();
            ui.text(`Failed to publish: ${this.error}`);
        }
    }

    /**
     * Publishes the project to the cloud
     * @param {string} projectSlug Slug of the project name to publish to
     * @returns {ProjectInfo } Project info
     */
    async publish(projectSlug) {
        const actionId = await this.createToken();
        if (!this.token || !(await this.validateAuthToken(this.token))) {
            tools.openBrowser(`https://wonderlandengine.com/account/?actionId=${actionId}`);
            const result = await this.pollActionResult();

            this.token = result;
        }

        if (this.cancelled) return null;

        this.state = STATE_UPLOADING;

        const cloudClient = new CloudClient({
            WLE_CREDENTIALS: this.token,
            WORK_DIR: project.root,
            COMMANDER_URL: 'https://cloud.wonderland.dev',
        });

        /* Use threads only if the server settings match */
        const useThreads = data.settings.editor.serverCOEP === 'require-corp';

        if (!!this.projectName) {
            const page = await cloudClient.page.get(this.projectName);
            if (page) {
                const updateProjectResponse = await cloudClient.page.update(
                    project.deployPath,
                    this.projectName,
                    this.listed,
                    useThreads
                );

                this.publishedUrl = updateProjectResponse.projectDomain;
                this.projectName = updateProjectResponse.projectName;

                return updateProjectResponse;
            }
        }

        const updateProjectResponse = await cloudClient.page.create(
            project.deployPath,
            projectSlug,
            this.listed,
            useThreads
        );

        this.publishedUrl = updateProjectResponse.projectDomain;
        this.projectName = updateProjectResponse.projectName;

        return updateProjectResponse;
    }

    async validateAuthToken(authToken) {
        const response = await fetch('https://api.wonderlandengine.com/user/me', {
            headers: {
                'Content-Type': 'application/json',
                Authorization: authToken,
                'User-Agent': 'WonderlandEditor/1.2.3',
            },
        });
        return response.status === 200;
    }

    tokenId = undefined;
    async createToken() {
        const raw = JSON.stringify({
            action: 'createToken',
            parameters: {
                projectName: 'TestProject',
            },
        });
        const requestOptions = {
            method: 'POST',
            headers: {
                'User-Agent': 'WonderlandEditor/1.2.3',
                'Content-Type': 'application/json',
            },
            body: raw,
            redirect: 'follow',
        };
        return await fetch(API_URL + '/auth/action', requestOptions)
            .then((response) => response.text())
            .then((data) => {
                this.tokenId = data;
                return data;
            });
    }

    async pollActionResult() {
        // get action result, once the result exists, we will delete the action
        const requestOptions = {
            method: 'GET',
            headers: {
                // TODO it's node here, not the editor :thinking:
                'User-Agent': 'WonderlandEditor/version',
            },
            redirect: 'follow',
        };

        let counter = 0;
        return new Promise(async (resolve, reject) => {
            try {
                let i;
                i = setInterval(async () => {
                    /* Poll access token */
                    const res = await fetch(
                        API_URL + `/auth/action/${this.tokenId}/result`,
                        requestOptions
                    ).then((response) => response.json());

                    if (counter > TIMEOUT_INTERVALS || this.cancelled) {
                        clearInterval(i);
                        reject();
                    }

                    // GET /auth/action/id
                    if (!!res.token) {
                        clearInterval(i);
                        /* display success.result or something like that in the ui */
                        resolve(res.token);
                    }
                }, POLLING_INTERVAL);
            } catch (e) {
                reject(e);
            }
        });
    }
}

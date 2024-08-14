import {EditorPlugin, ui, tools, data, project} from '@wonderlandengine/editor-api';
import {CloudClient} from '@wonderlandcloud/cli';
import open from 'open';

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
        } else {
            console.error(`Failed to clean project name: ${input}`);
            return null; // Return null if the string does not comply
        }
    }
    /* Use this function for drawing UI */
    draw() {
        ui.label(`project name: ${data.settings.project.name}`);
        ui.separator();
        ui.label(`Working Directory: ${project.root}`);
        ui.separator();
        ui.label(`Deploy Directory: ${project.deployPath}`);
        ui.separator();
        if (ui.button('Upload')) {
            this.error = '';
            const cleanName = this.correctProjectName(data.settings.project.name);
            if (cleanName) {
                tools.packageProject().then(async () => {
                    try {
                        const result = await this.publish(cleanName);
                        this.error = '';
                    } catch (e) {
                        console.error(e);
                        this.error = e;
                    }
                });
            }
        }
        ui.separator();
        if (this.publishedUrl) {
            ui.separator();
            ui.label(`Published at: ${this.publishedUrl}`);
            ui.separator();
            if (ui.button('Open')) {
                open(`https://${this.publishedUrl}`)
                    .then(() => {})
                    .catch((e) => {});
            }
        }

        if (this.error) {
            ui.separator();
            ui.separator();
            ui.label(`Failed to publish: ${this.error}`);
        }
    }

    /**
     * Publishes the project to the cloud
     * @param {string} projectName
     * @returns {ProjectInfo } Project info
     */
    async publish(projectName) {
        const api = new Api();
        const action = await api.createToken();
        console.log(`created action token: ${action.id}`);

        if (!this.token || !(await this.validateAuthToken(this.token))) {
            await open(`https://wonderlandengine.com/account/?actionId=${action.id}`);
            const result = await api.pollActionResult();

            this.token = result;
        }

        const cloudClient = new CloudClient({
            WLE_CREDENTIALS: this.token, //result,
            WORK_DIR: project.root,
            COMMANDER_URL: 'https://cloud.wonderland.dev',
        });

        if (!!this.projectName) {
            const page = await cloudClient.page.get(this.projectName);
            console.log(page);
            if (page) {
                const updateProjectResponse = await cloudClient.page.update(
                    project.deployPath,
                    this.projectName,
                    true,
                    true
                );

                this.publishedUrl = updateProjectResponse.projectDomain;
                this.projectName = updateProjectResponse.projectName;

                return updateProjectResponse;
            }
        }

        const updateProjectResponse = await cloudClient.page.create(
            project.deployPath,
            projectName,
            true,
            true
        );
        console.log(updateProjectResponse);

        this.publishedUrl = updateProjectResponse.projectDomain;
        this.projectName = updateProjectResponse.projectName;

        return updateProjectResponse;
    }

    async validateAuthToken(authToken) {
        const response = await fetch('https://api.wonderlandengine.com/user/me', {
            headers: {
                'Content-Type': 'application/json',
                Authorization: authToken,
                'User-Agent': 'WonderlandEditor/1.2.2',
            },
        });
        if (response.status === 200) {
            return true;
        } else {
            return false;
        }
    }
}
const API_URL = 'https://api.wonderlandengine.com';
const POLLING_INTERVAL = 5000;
class Action {
    id = '';
    constructor(id) {
        this.id = id;
    }
}
class Api {
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
                'User-Agent': 'WonderlandEditor/1.2.2',
                'Content-Type': 'application/json',
            },
            body: raw,
            redirect: 'follow',
        };
        return new Action(
            await fetch(API_URL + '/auth/action', requestOptions).then((response) =>
                response.text().then((data) => {
                    this.tokenId = data;
                    return data;
                })
            )
        );
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
                    console.log(`polling: ${counter++}`);
                    console.log(res);
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

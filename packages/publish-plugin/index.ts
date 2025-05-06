import {EditorPlugin, ui, tools, data, project} from '@wonderlandengine/editor-api';
import {CloudClient} from '@wonderlandcloud/cli';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, relative} from 'node:path';

interface ProjectInfo {
    fullProjectUrl: string;
    projectDomain: string;
    accessType: 'public' | 'private';
    email: string;
    projectName: string;
    id: string;
    ownedByMe: boolean;
    starredCount: number;
    starredByMe: boolean;
    withThreads: boolean;
    description: string;
    image: string;
    teams: string[];
};

const v = data.settings.project.version;
const VERSION = `${v[0]}.${v[1]}.${v[2]}${v[3] ? '-rc' + v[3] : ''}`;

const STATE_NONE = 0;
const STATE_CONFIRMING = 1;
const STATE_UPLOADING = 2;
const STATE_PUBLISHED = 3;

const API_URL = 'https://api.wonderlandengine.com';
/* Check action confirmation every 5 seconds */
const POLLING_INTERVAL = 5000;
/* Timeout action confirmation in 60 seconds */
const TIMEOUT_INTERVALS = (60 * 1000) / POLLING_INTERVAL;

const loadDeploymentConfig = () => {
    const configPath = join(project.root, 'deployment.json');
    if (!existsSync(configPath)) return null;
    const contents = readFileSync(configPath, {
        encoding: 'utf8',
    });
    if (!contents) return null;
    console.log('[publish-plugin] Loaded config from deployment.json');
    return JSON.parse(contents);
};
const saveDeploymentConfig = (uploadProjectResponse: ProjectInfo) => {
    writeFileSync(
        join(project.root, 'deployment.json'),
        JSON.stringify({
            projectLocation: relative(project.root, project.deployPath),
            projectName: uploadProjectResponse.projectName,
            projectDomain: uploadProjectResponse.projectDomain,
            accessType: uploadProjectResponse.accessType,
            withThreads: uploadProjectResponse.withThreads,
        })
    );
};

export default class PublishPlugin extends EditorPlugin {
    name = 'Wonderland Cloud - Publish';

    projectDomain: string|null = null;
    projectName: string|null = null;

    state = STATE_NONE;
    cancelled = false;
    listed = true;

    tokenId?: string;

    error = '';

    /* The constructor is called when your plugin is loaded */
    constructor() {
        super();
    }

    reset() {
        this.projectDomain = null;
        this.projectName = null;

        this.state = STATE_NONE;
        this.cancelled = false;
        this.listed = true;

        this.error = '';
    }

    postProjectLoad() {
        this.reset();

        const config = loadDeploymentConfig();
        if (config) {
            this.listed = config.accessType === 'public';
            this.projectName = config.projectName;
            this.projectDomain = config.projectDomain;
            this.state = STATE_PUBLISHED;
        }

        return true;
    }

    slugify(input: string) {
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

        if (this.state === STATE_NONE || this.state === STATE_PUBLISHED) {
            this.listed = ui.checkbox('Publicly listed', this.listed) ?? this.listed;

            const label =
                this.state === STATE_NONE ? 'Publish to Wonderland Pages' : 'Update';
            if (ui.button(label)) {
                this.error = '';
                const slug = this.projectName ?? this.slugify(data.settings.project.name);
                if (slug) {
                    this.publish(slug)
                        .catch((e) => {
                            console.error(e);
                            this.error = e;
                        })
                        .finally(
                            () =>
                                (this.state = !!this.projectName
                                    ? STATE_PUBLISHED
                                    : STATE_NONE)
                        );
                } else {
                    this.error = 'Unable to create a slug from the project name';
                }
            }
        } else if (this.state === STATE_CONFIRMING) {
            ui.text('Confirm in your browser.');
            if (ui.button('Cancel')) {
                this.cancelled = true;
            }
        } else if (this.state === STATE_UPLOADING) {
            ui.text('Uploading deployment.');
            if (ui.spinner) ui.spinner();
        }

        if (this.state === STATE_PUBLISHED) {
            if (this.projectDomain) {
                ui.separator();
                ui.text(`Published at:\n${this.projectDomain}`);
                if (ui.button('Open in Browser')) {
                    tools.openBrowser(`https://${this.projectDomain}`);
                }
                ui.sameLine();
                if (ui.button('Manage')) {
                    tools.openBrowser(`https://cloud.wonderland.dev/pages`);
                }
            }
        }

        if (this.error) {
            ui.separator();
            ui.text(`Failed to publish: ${this.error}`);
        }
    }

    /**
     * Publishes the project to the cloud
     * @param projectSlug Slug of the project name to publish to
     * @returns Project info
     */
    async publish(projectSlug: string) {
        this.state = STATE_CONFIRMING;

        this.cancelled = false;
        await tools.packageProject();
        const actionId = await this.createToken();

        tools.openBrowser(`https://wonderlandengine.com/account/?actionId=${actionId}`);
        const token = await this.pollActionResult();

        if (this.cancelled) return;

        this.state = STATE_UPLOADING;

        const config = {
            WLE_CREDENTIALS: token,
            WORK_DIR: project.root,
            COMMANDER_URL: 'https://cloud.wonderland.dev',
        };
        const cloudClient = new CloudClient(config);

        /* Use threads only if the server settings match */
        const useThreads = data.settings.editor.serverCOEP === 'require-corp';

        let updateProjectResponse: ProjectInfo|null = null;
        if (!!this.projectName) {
            const page = await cloudClient.page.get(this.projectName);
            if (page) {
                updateProjectResponse = (await cloudClient.page.update(
                    project.deployPath,
                    this.projectName,
                    this.listed,
                    useThreads
                )) as ProjectInfo;
            }
        }

        /* Page did not exist */
        if (!updateProjectResponse) {
            updateProjectResponse = (await cloudClient.page.create(
                project.deployPath,
                projectSlug,
                this.listed,
                useThreads
            )) as ProjectInfo;
        }

        this.projectDomain = updateProjectResponse.projectDomain;
        this.projectName = updateProjectResponse.projectName;

        saveDeploymentConfig(updateProjectResponse);

        return;
    }

    async createToken() {
        const raw = JSON.stringify({
            action: 'createToken',
            parameters: {
                projectName: data.settings.project.name,
            },
        });
        return await fetch(API_URL + '/auth/action', {
            method: 'POST',
            headers: {
                'User-Agent': 'WonderlandEditor/' + VERSION,
                'Content-Type': 'application/json',
            },
            body: raw,
            redirect: 'follow',
        })
        .then((response) => response.text())
        .then((data) => {
            this.tokenId = data;
            return data;
        });
    }

    async pollActionResult() {
        // get action result, once the result exists, we will delete the action

        let counter = 0;
        return new Promise(async (resolve, reject) => {
            try {
                let i: number;
                i = setInterval(async () => {
                    /* Poll access token */
                    const res = await fetch(
                        API_URL + `/auth/action/${this.tokenId}/result`,
                        {
                            method: 'GET',
                            headers: {
                                'User-Agent': 'WonderlandEditor/' + VERSION,
                            },
                            redirect: 'follow',
                        }
                    ).then((response) => response.json());

                    if (counter > TIMEOUT_INTERVALS) {
                        clearInterval(i);
                        reject('Action timed out.');
                        return;
                    }
                    if (this.cancelled) {
                        clearInterval(i);
                        reject('Action cancelled.');
                        return;
                    }

                    if (!!res.token) {
                        clearInterval(i);
                        resolve(res.token);
                    }
                }, POLLING_INTERVAL);
            } catch (e) {
                reject(e);
            }
        });
    }
}

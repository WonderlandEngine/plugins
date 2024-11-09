import {EditorPlugin, project, ui, data} from '@wonderlandengine/editor-api';
import {existsSync} from 'node:fs';

/**
 * Plugin to cleanup resources with broken links.
 */
export default class CleanupPlugin extends EditorPlugin {
    result: Record<string, string[]> = {};

    /* The constructor is called when your plugin is loaded */
    constructor() {
        super();
        this.name = 'Project Cleanup Plugin';
    }

    /* Use this function for drawing UI */
    draw() {
        ui.text('Unused Resources');
        ui.separator();

        if (Object.keys(this.result).length == 0) {
            this.collectResources();
            return;
        }

        for (let k of Object.keys(this.result)) {
            ui.text(`Found ${this.result[k].length.toString()} unused ${k}`);
        }

        ui.separator();
        if (ui.button('Refresh')) {
            this.collectResources();
        }
        ui.sameLine();
        if (ui.button('Delete all')) {
            this.cleanup();
        }
    }

    LINK_CACHE: Record<string, boolean> = {};

    /* Check whether the file linked by a resource exists, caching the result */
    linkExists(path: string) {
        if (!(path in this.LINK_CACHE)) {
            /* Try as relative to project root first then unprefixed in case it's an absolute path */
            this.LINK_CACHE[path] = existsSync(project.root + '/' + path) || existsSync(path);
        }
        return this.LINK_CACHE[path];
    }

    /* Collect all resources whose linked file is missing */
    collectResources() {
        /* Clear previous results and link cache */
        this.result = {};
        this.LINK_CACHE = {};

        for (let res of [
            'meshes',
            'textures',
            'materials',
            'images',
            'animations',
            'skins',
        ]) {
            const list = [];
            for (const k of Object.keys(data[res])) {
                const file = data[res][k].link?.file;
                if (file && file !== 'default' && !this.linkExists(file)) {
                    list.push(k);
                }
            }

            this.result[res] = list;
        }
    }

    cleanup() {
        for (let r of Object.keys(this.result)) {
            for (let k of this.result[r]) {
                delete data[r][k];
            }
            console.log('Deleted', this.result[r].length, r);
        }

        this.collectResources();
    }
}

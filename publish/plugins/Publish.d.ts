type ProjectInfo = {
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

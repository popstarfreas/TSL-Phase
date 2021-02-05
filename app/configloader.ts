export interface Config {
    username: string;
    password: string;
    ip: string;
    port: number;
    vhost: string;
    subExchangeName: string;
    pubExchangeName: string;
    token: string;
}

export const config: Config = require(`${process.cwd()}/config/rabbitconfig.js`);

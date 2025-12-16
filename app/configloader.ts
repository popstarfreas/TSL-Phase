import fs from "node:fs";
import yaml from "yaml";

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

if (!fs.existsSync(`${process.cwd()}/config/rabbitconfig.yaml`)) {
    throw new Error("RabbitMQ config file not found. Please create a config/rabbitconfig.yaml file.");
}

export const config: Config = yaml.parse(fs.readFileSync(`${process.cwd()}/config/rabbitconfig.yaml`, "utf8"));

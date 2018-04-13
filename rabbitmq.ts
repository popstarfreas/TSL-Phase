import * as amqp from "amqplib";
import { EventEmitter } from "events";
import * as util from "util";
import { Config, config } from "./configloader";

class RabbitMQ extends EventEmitter {
  private _connected: boolean;
  private _channel: amqp.Channel;
  private _config: Config = config;

  constructor() {
    super();
    this._connected = false;
  }

  /**
   * Connects to a RabbitMQ server
   *
   * @param user The username for the RabbitMQ server
   * @param pass The password for the given username
   * @param ip The IP address of the RabbitMQ server
   * @param port The port address of the RabbitMQ server
   * @param vhost The vhost to use
   */
  public async connect(): Promise<void> {
    const connectionString = `amqp://${this._config.username}:${encodeURIComponent(this._config.password)}@${this._config.ip}:${this._config.port}/${this._config.vhost}`;

    try {
      const connection = await amqp.connect(connectionString);
      this._channel = await connection.createChannel();
    } catch (e) {
      console.log(`RabbitMQ Exception: ${e}`);
    }
  }

  public close(): void {
    this._channel.close();
  }

  /**
   * Assert an exchange into existence
   *
   * @param name The name of the exchange
   * @param type The type of the exchange
   */
  private assertExchange(name: string, type: string = "fanout"): void {
    this._channel.assertExchange(name, type, {});
  }

  /**
   * Subscribes to an exchange, causing messages received to be emitted
   *
   * @param exchange The exchange to subscribe to
   */
  public async subscribe(exchange: string, handler: (message: Object) => void): Promise<void> {
    const queue = await this._channel.assertQueue("", { exclusive: true});
    this._channel.bindQueue(queue.queue, exchange, "");

    this._channel.consume(queue.queue, (msg) => {
        handler(JSON.parse(msg.content.toString()));
    },
    {
      noAck: true
    });
  }

  /**
   * Publishes a message on the given exchange
   *
   * @param exchange The exchange to publish to
   * @param message The message to publish to the exchange
   */
  public publish(exchange: string, message: string): void {
    if (typeof this._channel !== "undefined") {
      this._channel.publish(exchange, "", new Buffer(message));
    }
  }
}

export default RabbitMQ;

import * as amqp from "amqplib/callback_api.js";
import { EventEmitter } from "events";
import { Config, config } from "./configloader.js";
import * as winston from "winston";

class RabbitMQ extends EventEmitter {
  private _connected: boolean;
  private _connection?: amqp.Connection;
  private _channel?: amqp.Channel;
  private _queue!: string;
  private _config: Config = config;
  private _logger: winston.Logger;
  private _subscription: { exchange: string; handler: (message: any) => void } | null = null;

  constructor(logger: winston.Logger) {
    super();
    this._logger = logger;
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

    return new Promise<void>((resolve, reject) => {
      console.log("Connecting...");
      amqp.connect(connectionString, async (err, connection) => {
        if (err) {
          this._logger.error(`RabbitMQ Connect Error: ${err}`);
          return reject(err);
        }
        console.log("Connected");

        this._connection = connection;
        this._connection.on("error", e => {
          this._logger.error(`RabbitMQ connection error: ${e.toString()}`);
          reject(e);
        });
        this._channel = await this.createChannel();
        this.emit("connected");
      });
    });
  }

  private createChannel(): Promise<amqp.Channel> {
    return new Promise((resolve, reject) => {
      this._connection?.createChannel((err, channel) => {
        if (err) {
          this._logger.error(`RabbitMQ channel error: ${err.toString()}`);
          return reject(err);
        }

        console.log("Channel connected");
        resolve(channel);
      });
    });
  }

  public close(): void {
    this._channel?.close(e => e ? this._logger.error(`RabbitMQ Channel Close Error: ${e}`) : {});
    this._connection?.close(e => e ? this._logger.error(`RabbitMQ Connection Close Error: ${e}`) : {});
  }

  /**
   * Assert an exchange into existence
   *
   * @param name The name of the exchange
   * @param type The type of the exchange
   */
  private assertExchange(name: string, type: string = "fanout"): void {
    if (typeof this._channel !== "undefined") {
      this._channel.assertExchange(name, type, {});
    }
  }

  private assertQueue(name: string, options?: amqp.Options.AssertQueue): Promise<amqp.Replies.AssertQueue> {
    return new Promise<amqp.Replies.AssertQueue>((resolve, reject) => {
      if (typeof this._channel !== "undefined") {
        this._channel.assertQueue(name, options, (err, ok) => {
          if (err) {
            return reject(err);
          }

          console.log("Connected queue.")
          resolve(ok);
        });
      }
    });
  }

  /**
   * Subscribes to an exchange, causing messages received to be emitted
   *
   * @param exchange The exchange to subscribe to
   */
  public async subscribe(exchange: string, handler: (message: any) => void): Promise<void> {
    this._subscription = {
      exchange,
      handler
    };
    if (typeof this._channel === "undefined") {
      return;
    }

    console.log("Subscribing to queue")
    this._queue = (await this.assertQueue("", { exclusive: true })).queue;
    console.log("Subscribed to queue")
    this._channel.bindQueue(this._queue, exchange, "");
    this._channel.consume(this._queue, (msg) => {
      try {
        if (msg !== null) {
          handler(JSON.parse(msg.content.toString()));
        }
      } catch (e) {
        if (e instanceof Error) {
          this._logger.error("Message consumption error: " + e.toString());
        } else {
          this._logger.error("Message consumption error: unknown");
        }
      }
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
  public async publish(exchange: string, message: string) {
    if (typeof this._channel !== "undefined") {
      try {
        this._channel.publish(exchange, "", new Buffer(message));
      } catch (e) {
        if (e instanceof Error) {
          this._logger.error("Message publish error: " + e.toString());
        } else {
          this._logger.error("Message publish error: unknown");
        }
      }
    }
  }
}

export default RabbitMQ;

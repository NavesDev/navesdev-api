import fastify from "fastify";
import cors from "@fastify/cors";
import ratelimit, { fastifyRateLimit } from "@fastify/rate-limit";
import cookies from "@fastify/cookie";
import mysql from "mysql2";
import redis from "@fastify/redis";
import ms from "ms";
import stc from "@fastify/static";
import path from "path";
import Ajv, { str } from "ajv";
import { error, timeStamp } from "console";
const ajv = new Ajv();

require("dotenv").config();

const version = "v1.0";

const app = fastify({
  trustProxy: true,
});

async function bootstrap() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    port: parseInt(process.env.DB_PORT, 10),
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  await app.register(cors, {
    origin: "*", //["https://navesdev.github.io","https://navesdev-api.vercel.app",process.env.PERSONAL_IP, "*"],
    credentials: true,
  });

  await app.register(stc, {
    root: path.join(__dirname, "..", "public"),
  });

  await app.register(redis, {
    url: process.env.REDIS_URL,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
  });

  await app.register(ratelimit, {
    max: 60,
    timeWindow: "1h",
    global: true,
    redis: app.redis,
    keyGenerator: function (request) {
      const ip = request.ip;
      console.log(
        { actor: "RateLimit", key: `${ip}` },
        `Nova tentativa de requisição`
      );
      return ip;
    },
    errorResponseBuilder: function (request, context) {
      request.log.warn(
        { actor: "RateLimit", ip: request.ip },
        `RATE LIMIT ATINGIDO!`
      );
      return {
        statusCode: 429,
        error: "Too Many Requests",
        message: `Limite de requisições atingido (${
          context.max
        }). Tente de novo em ${Math.ceil(context.ttl / 1000)}s ou ${Math.ceil(
          context.ttl / (1000 * 60)
        )}m.`,
        retryAfter: context.ttl / 1000,
      };
    },
  });

  await app.register(cookies);

  async function searchDataByName(name: string, wantedData: string) {
    const query = `SELECT ${wantedData} FROM website WHERE wname = ?`; //const query = "SELECT waccess FROM website WHERE wname = ?"
    try {
      const [rows]: any[] = await pool.promise().query(query, [name]);
      const data = rows.length > 0 ? rows[0] : null;
      if (data) {
        return {
          status: true,
          response: data,
        };
      } else {
        return {
          status: false,
          message: "Website não encontrado.",
          code: 404,
        };
      }
    } catch (error) {
      return {
        status: false,
        message: "Erro interno, tente novamente mais tarde.",
        code: 500,
      };
    }
  }

  await app.get(
    "/",
    { config: { cors: { origin: "https://navesdev-api.vercel.app" } } },
    (request, reply) => {
      return reply.sendFile("index.html");
    }
  );

  await app.get("/websites", async (request, reply) => {
    try {
      const [rows]: any[] = await pool
        .promise()
        .query("SELECT wname,waccess,wcdate FROM website");
      if (rows.length > 0) {
        return reply.code(200).send({
          status: true,
          response: rows,
        });
      } else {
        return reply.code(404).send({
          status: false,
          message: "Não foram encontrados websites por algum motivo.",
        });
      }
    } catch (error) {
      return reply.code(500).send({
        status: false,
        message:
          "Houve um erro de comunicação no servidor, tente novamente mais tarde.",
      });
    }
  });

  await app.get("/websites/:name", async (request: any, reply) => {
    const name = request.params.name;
    const response = await searchDataByName(name, "waccess,wname,wcdate");

    return response;
  });

  const lessRequestC = {
    config: {
      rateLimit: {
        max: 1,
        timeWindow: "10m",
        keyGenerator: function (request) {
          const name = request.params.name;
          const ip = request.ip;
          request.log.info(
            { actor: "RateLimit", key: `${name} - ${ip}` },
            `Nova tentativa de acesso`
          );
          return `${name} - ${ip}`;
        },
        errorResponseBuilder: function (request, context) {
          request.log.warn(
            { actor: "RateLimit", ip: request.ip },
            `RATE LIMIT ATINGIDO!`
          );
          return {
            statusCode: 429,
            error: "Too Many Requests",
            message: `Já foi registrado um acesso recentemente no seu dispositivo. Tente de novo em ${Math.ceil(
              context.ttl / 1000
            )}s ou ${Math.ceil(context.ttl / (1000 * 60))}m.`,
            retryAfter: context.ttl / 1000,
          };
        },
      },
    },
  };

  await app.get(
    "/websites/:name/newaccess",
    lessRequestC,
    async (request: any, reply) => {
      const name = request.params.name;

      try {
        const [result]: any = await pool
          .promise()
          .query("UPDATE website SET waccess = waccess + 1 WHERE wname= ?", [
            name,
          ]);
        if (result.affectedRows === 0) {
          return reply
            .status(404)
            .send({ status: false, message: "Website não encontrado" });
        } else {
          return reply.send({
            status: true,
            nextAccess: ms(lessRequestC.config.rateLimit.timeWindow),
          });
        }
      } catch (error) {
        return reply.code(500).send({
          status: false,
          message: "Erro de comunicação interno, tente mais tarde",
        });
      }
    }
  );
  const ailifetime = 60 * 60;

  await app.get(
    "/camisAI/loadAssets",
    {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: `${ailifetime}s`,
          keyGenerator: function (request) {
            return 1;
          },
          errorResponseBuilder: function (request, context) {
            request.log.warn(
              { actor: "RateLimit", ip: request.ip },
              `RATE LIMIT ATINGIDO!`
            );
            return {
              statusCode: 429,
              error: "Too Many Requests",
              message: `Os assets já estão salvos. Nova necessidade em ${Math.ceil(
                context.ttl / 1000
              )}s ou ${Math.ceil(context.ttl / (1000 * 60))}m.`,
              retryAfter: context.ttl / 1000,
            };
          },
        },
      },
    },

    async (request, reply) => {
      try {
        let cache = await app.redis.get(`aiAssets-${version}`);
        if (cache) {
          return reply.send({
            status: true,
            message: "Carregado com sucesso no sistema (???)",
            lifetime: await app.redis.ttl(`aiAssets-${version}`),
          });
        } else {
          const [projects] = await pool
            .promise()
            .query("select * from website");
          const [secs] = await pool.promise().query("select * from sections");
          const dbData = {
            websites: projects,
            sections: secs,
          };

          const result = await app.redis.set(
            `aiAssets-${version}`,
            JSON.stringify(dbData),
            "EX",
            ailifetime
          );
          if (result == "OK") {
            return reply.send({
              status: true,
              message: "Salvo com sucesso no sistema ",
              lifetime: ailifetime,
            });
          } else {
            throw new Error("Não foi possível salvar os dados da IA");
          }
        }
      } catch (error) {
        console.error(error);
        return reply
          .code(500)
          .send({ status: false, message: "Erro interno do servidor" });
      }
    }
  );
  async function getAiAssets() {
    let cache = await app.redis.get(`aiAssets-${version}`);
    if (cache) {
      return { status: true, data: JSON.parse(cache) };
    } else {
      const response = await fetch("http://localhost:1607/camisAI/loadAssets");
      if (response.status == 200) {
        return {
          status: true,
          message:
            "Data não estava salva, mas foi salva com sucesso. Tente novamente.",
          data: JSON.parse(cache),
        };
      } else {
        throw Error("Erro de salvamento de dados");
      }
    }
  }

  const msgprefix = "camisaiv1-chatHistory-";
  const maxHistoryLifetime = 60 * 60 * 24 * 7;
  const maxHistoryLength = 20;

  async function chatManager(
    userid,
    newmsg = null,
    role = null,
    commands = null,
    lastHistory = null
  ) {
    let newHistory: any[];
    try {
      if (!lastHistory) {
        const lastHistory = await app.redis.get(`${msgprefix}${userid}`);
        newHistory = lastHistory ? JSON.parse(lastHistory) : [];
      } else {
        newHistory = lastHistory;
      }
      if (newmsg && role) {
       
        if (newHistory.length >= maxHistoryLength) {
          newHistory.shift();
        }
        if(role=="model"){
          newHistory.push({ role: role, message: newmsg, commands:commands??[], timestamp: new Date().toISOString() });
        } else{
          newHistory.push({ role: role, message: newmsg, timestamp: new Date().toISOString() });
        }
        
        app.redis.set(
          `${msgprefix}${userid}`,
          JSON.stringify(newHistory),
          "EX",
          maxHistoryLifetime
        );
      }
      return newHistory;
    } catch (error) {
      console.log(error);
      return (role=="model") ? [
        {
          role: role,
          text :{ message: newmsg, commands:commands??[], timestamp: new Date().toISOString()},
        }
      ]: [{ role: role, message: newmsg, timestamp: new Date().toISOString() }];
    }
  }

  function toAiChat(chat){
    const newchat = []
    for(const element of chat){
      const prompt = `[${element?.timestamp}] ${element?.message}`
      newchat.push({role:element.role,parts:[{text:prompt}]})
    }
    return newchat;
  }

  const banlvls = {
    1:30,
    2:60*10,
    3:60*15
  }

  const banPrefix = `camisaiv1-tempban-`
  async function aiCheckBan(userid) {

    const inBan = await app.redis.ttl(`${banPrefix}${userid}`)
      
      if(inBan>0){
        console.log(`Banned user try Request - ${userid}`)
        return inBan;
      } else{
        return false;
      }
  }
  async function aiTempBan(userid,level = 1) {
    if(level in banlvls){
     
      console.log(`tempban lvl${level} - ${userid} - ${await app.redis.set(
          `${banPrefix}${userid}`,
          "banned",
          "EX",
          banlvls[level]
        )}`);  
        
        
    }      
    
  }

  async function aiWarn(userid){
    const key = `camisaiv1-warn-${userid}`
    const gotWarn = await app.redis.get(key)
    
    if(gotWarn){
      await aiTempBan(userid,3)
    } else {
      console.log(`warn - ${userid}`)
      await app.redis.set(
          key,
          "1",
          "EX",
          60*15
        );
    }
  }
  const aiLimits = [app.createRateLimit({
            max: 8,
            timeWindow: 1000*60,
            keyGenerator: () => "chat_global_limit"
          }),
        app.createRateLimit({
            max: 4,
            timeWindow: 1000*60,
            keyGenerator: (request) => request.ip,
          })]

  await app.get("/camisAI/history", {config:{
    rateLimit:{
      max:10,
      timeWindow:1000*60
    }
  }},async (request,reply)=>{
    const history = await chatManager(request.ip)
    return reply.send({status:true,history : history})
  })
  await app.post(
    "/camisAI/chat",
    async (request, reply) => {
      const limit1:any = await aiLimits[0](request)
      const limit2:any = await aiLimits[1](request)
      if((!limit1.isAllowed && limit1.isExceeded) || (!limit2.isAllowed && limit2.isExceeded)){
        const context = limit2
        return reply.code(429).send({
        statusCode: 429,
        error: "Too Many Requests",
        message: `Limite de requisições atingido (${
          context.max
        }). Tente de novo em ${Math.ceil(context.ttl / 1000)}s ou ${Math.ceil(
          context.ttl / (1000 * 60)
        )}m.`,
        retryAfter: context.ttl / 1000,
      });
      }
      const inBan = await aiCheckBan(request.ip)
      if(inBan){
        return reply.code(429).send({
        statusCode: 429,
        error: "Temp Ban",
        message: `Você foi banido por mal uso da Camis AI. Tente de novo em ${Math.ceil(inBan)}s ou ${Math.ceil(inBan / 60)}m.`,
        retryAfter: inBan / 1000,
      })
      }
      try {
        const validate = ajv.compile({
          type: "object",
          properties: {
            prompt: { type: "string" },
          },
          required: ["prompt"],
          additionalProperties: false,
        });
        let body = request.body as { prompt: string };
        if (!validate(body) || body.prompt.length > 200) {
          return reply.code(400).send({
            status: false,
            message: "O corpo da requisição é inválido",
            details: validate.errors,
          });
        }

        const {data} = await getAiAssets();
        const chat = await chatManager(request.ip, body.prompt, "user");
        
       
       const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : `http://localhost:${process.env.PORT || 1607}`;

        const pythonApiUrl = `${baseUrl}/internal/aiservice/camisai`;
        let response = await fetch(
          pythonApiUrl, //"http:127.0.0.1:5001/camisai"
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-token": process.env.INTERNAL_KEY,
            },
            
            body: JSON.stringify({
              history: toAiChat(chat),
              dbData: data,
            }),
          }
        );
        if(!response.ok){
          
          const fullError:any = await response.json()
          const errormsg = {status : false,message: "", commands:[], sender:"server"}
          errormsg.message = fullError?.detail?.specialMessage ?? "Houve um problema ao entrar em contato com a IA, tente novamente"
          
          if(fullError?.detail?.specialCode){
            const code = fullError.detail["specialCode"].split(".")
            if(code[0] == "1"){
              errormsg.sender = "model"
            }
            if(code[1]=="1"){
              errormsg.commands.push("tempban1")
              await aiTempBan(request.ip,1)
            }else if(code[1]=="5"){
              errormsg.commands.push("tempban3")
              await aiTempBan(request.ip,3)
            }
          }
          
          return reply.send(errormsg);
        }
        const newdata:any = await response.json()
        newdata["sender"] = "model"
        if(newdata.commands.includes("warn")){
          await aiWarn(request.ip)
        }
        chatManager(request.ip,newdata.message,"model",newdata.commands,chat)
        return reply.send(newdata);
      } catch (error) {
        app.log.info(error);
        console.error(error);
        return reply
          .code(500)
          .send({
            status: false,
            message: "Erro interno do servidor"
          });
      }
    }
  );
  return app;
}

bootstrap().then((app) => {
  app.listen({ port: 1607 }).then(() => {
    console.log("API Online!");
    console.log(`Running at http://127.0.0.1:1607/`)
  });
});

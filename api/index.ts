import {fastify} from "fastify";
import cors from "@fastify/cors";
import rl from "@fastify/rate-limit";

const app = fastify();

app.register(cors,{
    origin : "*" //"http://navesdev.github.io"
})

app.register(rl,{
    max : 60,
    timeWindow: '1h'
})

const apiRegs = (app)=> {
    app.register(rl,{
        max : 8,
        timeWindow:"1m"
    })
    
    app.get("/websites/newacess/:name", (request, reply)=>{
        const name = request.params.name

        return reply.status(404).send({ error: "Usuário não encontrado" });
    })
}

app.register(apiRegs)

app.get("/",()=>{
    return "Hello Word"
})


app.listen({port : 1607}).then(()=>{
    console.log("API Online!")
})
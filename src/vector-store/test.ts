import { CodeVectorStore } from ".";
import { Config } from '../config';

let vectorStore = new CodeVectorStore({
            type: 'supabase',
            openAIApiKey: Config.openaiApiKey,
            supabase: {
                url: Config.superbaseUrl,
                key: Config.supabaseKey,
                tableName: 'codes',
                queryName: 'codes'
              }
           
        });

     async function test() {

       let r =  await vectorStore.search("Give me all the express routes");
       console.log(r)
     }

     test();
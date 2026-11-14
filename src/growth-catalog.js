// Curated starter content. These are real activities, not pre-awarded user results.
const all = ['Frontend Developer','Backend Developer','Full-Stack Developer'];
const web = ['Frontend Developer','Full-Stack Developer'];
const server = ['Backend Developer','Full-Stack Developer'];
const mcq = (id,prompt,options,correctAnswer,points=10) => ({id,type:'mcq',prompt,options,correctAnswer,points,starterCode:'',rubric:'',tests:[]});
const written = (id,prompt,rubric,points=20) => ({id,type:'written',prompt,points,options:[],correctAnswer:'',starterCode:'',rubric,tests:[]});
const code = (id,prompt,tests,points=30) => ({id,type:'code',prompt,points,options:[],correctAnswer:'',starterCode:'// Read stdin and write the required result to stdout.\nconst fs = require("node:fs");\nconst input = fs.readFileSync(0, "utf8").trim();\n// Implement your solution below.\n',rubric:'Award 50% for correctness on the stated examples and edge cases, 25% for input validation, and 25% for clear, maintainable code. Syntax alone earns no correctness credit.',tests});

export const skillCatalog = [
  {slug:'javascript',name:'JavaScript',careerPaths:all,description:'Language fundamentals, asynchronous work and robust data transformations.'},
  {slug:'react',name:'React',careerPaths:web,description:'Components, state, effects, accessible forms and maintainable interfaces.'},
  {slug:'node',name:'Node.js',careerPaths:server,description:'HTTP services, Express middleware, validation, authorization and operational reliability.'},
  {slug:'postgresql',name:'PostgreSQL',careerPaths:server,description:'Relational modeling, safe queries, transactions, constraints and query performance.'},
];
const assessmentQuestions = [
  mcq('http','Which HTTP status should a successful resource creation return?',['200','201','401','500'],'201'),
  mcq('password','How should an application store user passwords?',['Plain text','A salted password hash','Reversible Base64','In browser storage'],'A salted password hash'),
  mcq('sql','What prevents SQL injection when a query includes user input?',['String concatenation','Parameterized queries','Hiding the form','A longer password'],'Parameterized queries'),
  mcq('promise','Which construct handles a rejected promise in async code?',['try / catch around await','A CSS rule','JSON.stringify','A React key'],'try / catch around await'),
  code('deduplicate','Read a JSON array of strings from stdin. Print a JSON array with duplicates removed, preserving first occurrence order. Reject non-array input with the output INVALID.',[
    {name:'Duplicate values',input:'["a","b","a"]',output:'["a","b"]'},
    {name:'Empty array',input:'[]',output:'[]'},
    {name:'Invalid input',input:'{"a":1}',output:'INVALID'},
  ]),
  written('design','Describe how you would validate a profile form and enforce ownership when saving it to an Express API.',
    'Award up to 10 points for client and server validation, 10 for session-based ownership (never trusting a supplied user ID), and 10 for useful errors and safe database writes.',30),
];
export const assessmentCatalog = all.map(path=>({slug:`${path.replace(' Developer','').toLowerCase()}-assessment`,kind:'assessment',title:`${path} Assessment`,description:'A timed assessment of practical JavaScript, web security and application design. Multiple-choice answers are scored automatically. Coding and written answers are reviewed by an administrator.',careerPaths:[path],durationMinutes:60,passScore:70,questions:assessmentQuestions,requirements:'Answer all questions. Work is saved as you go. Time continues when this tab is closed. Assessment retakes are available after 24 hours.'}));
const concepts = {
  javascript:[
    ['Array transformations','Which method creates a new array by transforming each element?',['map','push','pop','splice'],'map'],
    ['Immutable updates','Which expression creates a shallow copy of an array?',['[...items]','items.push(1)','items.sort()','items.reverse()'],'[...items]'],
    ['Strict comparisons','Which operator compares values without type coercion?',['===','==','=','!='],'==='],
    ['Lexical scope','Which declaration is block-scoped?',['let','var','A global assignment','An undeclared variable'],'let'],
    ['Asynchronous work','What does Promise.all do when one input promise rejects?',['Rejects with that failure','Always succeeds','Ignores that promise','Retries it forever'],'Rejects with that failure'],
    ['Error handling','Which block runs whether try succeeds or throws?',['finally','else','case','default'],'finally'],
    ['Object identity','What is the result of comparing two separately created empty objects with ===?',['false','true','null','undefined'],'false'],
    ['Data validation','Which reliably checks whether a value is an array?',['Array.isArray(value)','typeof value === "array"','value === []','value.length === 0'],'Array.isArray(value)'],
    ['Event loop','When is a fulfilled promise callback run relative to the current synchronous code?',['After the current call stack','Before all synchronous code','Only after one second','Never'],'After the current call stack'],
    ['Robust transformations','Which collection stores unique values?',['Set','Array','String','Promise'],'Set'],
  ],
  react:[
    ['Component boundaries','What should a reusable component receive as inputs?',['Props','A global mutation','A SQL connection','A DOM ID only'],'Props'],
    ['State updates','Which updater is safe when the next state depends on previous state?',['setCount(c => c + 1)','count++','count = count + 1','document.count = 1'],'setCount(c => c + 1)'],
    ['List identity','Which key is best for a reordered list of saved records?',['Stable record ID','Array position','Random number each render','Current timestamp'],'Stable record ID'],
    ['Controlled forms','What keeps a controlled text input editable?',['value and onChange','value only','disabled','A fixed default label'],'value and onChange'],
    ['Effects','What should an effect return to unsubscribe from a subscription?',['A cleanup function','A component','A CSS class','A database row'],'A cleanup function'],
    ['Derived data','How should a filtered list based on current props usually be represented?',['Derived during rendering','Copied into redundant state','Stored in a cookie','Mutating the props array'],'Derived during rendering'],
    ['Accessible forms','What associates a visible label with an input?',['htmlFor and a matching id','A placeholder only','A color','A border radius'],'htmlFor and a matching id'],
    ['Request cancellation','What can cancel an obsolete fetch request?',['AbortController','JSON.parse','setInterval','Array.sort'],'AbortController'],
    ['Error states','What should a failed save provide to the user?',['A useful error and retry path','A false success message','A blank page','A silent refresh'],'A useful error and retry path'],
    ['State ownership','Where should state shared by sibling components usually live?',['Their nearest common owner','In both siblings independently','In a CSS file','In a global DOM attribute'],'Their nearest common owner'],
  ],
  node:[
    ['Request routing','Which Express method handles a POST route?',['app.post','app.css','app.table','app.mountSQL'],'app.post'],
    ['Input validation','Where must security-relevant input validation run?',['On the server','Only in the browser','Only in CSS','Only in documentation'],'On the server'],
    ['Authentication','What identifies an authenticated request in this project?',['A validated server session','A user ID sent in the form','A display name','An email query parameter'],'A validated server session'],
    ['Authorization','What must a resource update check after authentication?',['Ownership or explicit permission','Only the button color','The browser width','The requested filename'],'Ownership or explicit permission'],
    ['Middleware order','When should authorization middleware run?',['Before protected route logic','After sending the response','Only during build','Only on the home page'],'Before protected route logic'],
    ['HTTP errors','Which status indicates an authenticated user lacks permission?',['403','201','302','101'],'403'],
    ['Request limits','Why cap incoming JSON body size?',['Limit resource exhaustion','Improve button spacing','Replace authentication','Enable SQL joins'],'Limit resource exhaustion'],
    ['Async failures','What should an API return for an unexpected server failure?',['A safe error without internal secrets','The database password','The entire stack trace','Another user session'],'A safe error without internal secrets'],
    ['Idempotency','What should repeated submission requests avoid?',['Duplicate final records','Stable response codes','Ownership checks','Input validation'],'Duplicate final records'],
    ['Service reliability','What should a database health check verify?',['A real database query','A static green label','The website title','A hardcoded timestamp'],'A real database query'],
  ],
  postgresql:[
    ['Primary keys','What identifies each row uniquely?',['PRIMARY KEY','ORDER BY','LIMIT','OFFSET'],'PRIMARY KEY'],
    ['Foreign keys','What enforces a reference to another table?',['FOREIGN KEY','GROUP BY','A text label','A browser route'],'FOREIGN KEY'],
    ['Parameterized SQL','Which PostgreSQL parameter placeholder is valid?',['$1','{userInput}','%user%','@HTML'],'$1'],
    ['Transactions','What cancels all uncommitted changes in a transaction?',['ROLLBACK','COMMIT','SELECT','ORDER BY'],'ROLLBACK'],
    ['Unique constraints','What prevents duplicate email identities at database level?',['A unique constraint or index','A frontend warning','A CSS selector','A timeout'],'A unique constraint or index'],
    ['Joins','Which join retains every row from the left table?',['LEFT JOIN','INNER JOIN','CROSS JOIN','RIGHT FILTER'],'LEFT JOIN'],
    ['Aggregations','Which clause filters grouped results?',['HAVING','WHERE before grouping','LIMIT only','VALUES'],'HAVING'],
    ['Concurrency','What can serialize concurrent updates to one row?',['SELECT FOR UPDATE inside a transaction','An HTML lock icon','A browser alert','ORDER BY alone'],'SELECT FOR UPDATE inside a transaction'],
    ['Indexes','Which command helps inspect a query execution plan?',['EXPLAIN','DROP DATABASE','REVOKE ALL','COPY PASSWORD'],'EXPLAIN'],
    ['Atomic operations','Which mechanism safely handles an insert that conflicts with a unique key?',['ON CONFLICT','String concatenation','A frontend delay','A larger text field'],'ON CONFLICT'],
  ],
};
export const challengeCatalog=skillCatalog.flatMap(skill=>concepts[skill.slug].map(([title,prompt,options,answer],index)=>({
  slug:`${skill.slug}-${index+1}`,kind:'challenge',skillSlug:skill.slug,position:index+1,title:`${skill.name}: ${title}`,careerPaths:skill.careerPaths,
  description:`Challenge ${index+1} of 10. Apply ${title.toLowerCase()} and explain your implementation choices.`,durationMinutes:30,passScore:70,
  requirements:'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.',
  questions:[mcq('knowledge',prompt,options,answer,40),skill.slug==='javascript'&&index===9?code('implementation',assessmentQuestions[4].prompt,assessmentQuestions[4].tests,60):written('application',`Give a concrete ${skill.name} example demonstrating ${title.toLowerCase()}. Include the implementation or query, explain an edge case, and describe how you would test it.`,
    'Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.',60)],
})));
export const projectCatalog=[
  ['accessible-profile','Accessible Profile Manager',web,'Build a responsive React profile editor with labeled fields, client validation, a loading state, an error state and a successful save state. Persist updates through an API. Include keyboard navigation and mobile screenshots.'],
  ['ticket-api','Support Ticket API',server,'Build an Express API to create, list, filter and update support tickets in PostgreSQL. Include parameterized SQL, pagination, server validation, authentication and owner-only updates. Document setup and test unauthorized requests.'],
  ['challenge-tracker','Challenge Progress Tracker',all,'Create a small application that lists challenges, records completions and displays progress. Ensure duplicate completion requests cannot award duplicate credit. Include a README, tests and a short demonstration.'],
  ['activity-history','Activity History Explorer',all,'Create a filterable activity history with server pagination, date filtering, empty/loading/error states and accessible controls. Include a reproducible setup and demonstrate at least three test cases.'],
  ['team-directory','Company Team Directory',all,'Build a company-scoped team directory with search and role labels. Enforce server-side membership checks and verify that one company cannot read another company’s members. Submit documentation and a demonstration.'],
].map(([slug,title,careerPaths,requirements],index)=>({slug,kind:'project',title,careerPaths,requirements,position:index+1,description:'An independent internal project. Submit your own repository, demonstration and evidence for administrator review.',durationMinutes:60,passScore:70,questions:[]}));

const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const arr=value=>'ARRAY['+value.map(literal).join(',')+']::text[]';
// This SQL only inserts absent catalogue slugs. It never resets user attempts or edits authored content.
export function growthCatalogSql() {
  const lines=['BEGIN;'];
  for(const s of skillCatalog) lines.push(`INSERT INTO growth_skills(slug,name,description,career_paths,status) VALUES(${literal(s.slug)},${literal(s.name)},${literal(s.description)},${arr(s.careerPaths)},'published') ON CONFLICT(slug) DO NOTHING;`);
  for(const a of [...assessmentCatalog,...challengeCatalog,...projectCatalog]) lines.push(`DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES(${literal(a.slug)},${literal(a.kind)},${a.skillSlug?`(SELECT id FROM growth_skills WHERE slug=${literal(a.skillSlug)})`:'NULL'},${a.position||1}) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,${literal(a.title)},${literal(a.description)},${arr(a.careerPaths)},${a.durationMinutes},${a.passScore},${literal(JSON.stringify(a.questions))}::jsonb,${literal(a.requirements)},'published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;`);
  lines.push("INSERT INTO schema_migrations(name) VALUES('004_growth_catalog') ON CONFLICT DO NOTHING;",'COMMIT;');
  return lines.join('\n');
}

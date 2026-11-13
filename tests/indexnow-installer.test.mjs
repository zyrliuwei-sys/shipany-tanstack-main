import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const installer = join(root, 'tools/indexnow-installer/install.mjs');

for (const modern of [false, true]) {
  test(`installer saves, verifies and submits through the ${modern ? 'unified' : 'standalone'} authenticated API`, () => {
    const target = mkdtempSync(
      join(tmpdir(), 'indexnow-installer-regression-')
    );
    try {
      for (const rel of ['package.json', 'tsconfig.json', 'src', 'messages']) {
        mkdirSync(dirname(join(target, rel)), { recursive: true });
        cpSync(join(root, rel), join(target, rel), { recursive: true });
      }
      symlinkSync(
        join(root, 'node_modules'),
        join(target, 'node_modules'),
        'dir'
      );
      if (!modern) rmSync(join(target, 'src/server/admin/handlers.ts'));
      execFileSync(process.execPath, [installer, target, '--force'], {
        stdio: 'pipe',
      });
      const route = readFileSync(
        join(target, 'src/routes/api/admin/indexnow.ts'),
        'utf8'
      );
      assert.equal(
        route.includes('runAdminRoute'),
        modern,
        'preserve modern authentication/audit integration'
      );
      const env = {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_URL: `file:${target}/test.db`,
        AUTH_SECRET: 'isolated-installer-regression-test-secret',
        VITE_APP_URL: 'https://installer.example.com',
        AUTH_URL: 'https://installer.example.com',
      };
      execFileSync(
        process.execPath,
        [
          join(root, 'node_modules/drizzle-kit/bin.cjs'),
          'push',
          '--dialect=sqlite',
          '--schema=./src/config/db/schema.sqlite.ts',
          `--url=${env.DATABASE_URL}`,
          '--force',
        ],
        { cwd: target, env, stdio: 'pipe' }
      );
      writeFileSync(
        join(target, 'verify.mjs'),
        `
        import assert from 'node:assert/strict';
        const { db } = await import('./src/core/db/index.ts');
        const s = await import('./src/config/db/schema.ts');
        const { getAuth } = await import('./src/core/auth/index.ts');
        const { hashPassword } = await import('better-auth/crypto');
        const service = await import('./src/modules/indexnow/service.ts');
        const { saveConfigs } = await import('./src/modules/config/service.ts');
        const { Route } = await import('./src/routes/api/admin/indexnow.ts');
        const { Route: keyRoute } = await import('./src/routes/{$key}[.]txt.ts');
        const origin = 'https://installer.example.com';
        const key = 'installer-test-key-12345678';
        await db().insert(s.user).values({id:'owner',name:'Owner',email:'installer@example.test',emailVerified:true});
        await db().insert(s.account).values({id:'credential',accountId:'owner',providerId:'credential',userId:'owner',password:await hashPassword('isolated-installer-password')});
        await db().insert(s.role).values({id:'owner-role',name:'super_admin',title:'Owner',status:'active'});
        await db().insert(s.permission).values({id:'all',code:'*',resource:'admin',action:'*',title:'All'});
        await db().insert(s.rolePermission).values({id:'rp',roleId:'owner-role',permissionId:'all'});
        await db().insert(s.userRole).values({id:'ur',roleId:'owner-role',userId:'owner'});
        // Reproduce the old installer's silent failure with protected settings.
        await saveConfigs({indexnow_key:key});
        assert.equal(await service.getIndexNowKey(), null);
        const login = await getAuth().api.signInEmail({body:{email:'installer@example.test',password:'isolated-installer-password'},headers:new Headers({origin}),asResponse:true});
        assert.equal(login.status,200);
        const cookie = login.headers.getSetCookie().map((v)=>v.split(';')[0]).join('; ');
        const call = async (method, body, authenticated=true, sessionCookie=cookie, requestOrigin=origin) => {
          globalThis.__minIntervalRateLimitStore?.clear();
          return Route.options.server.handlers[method]({request:new Request(origin+'/api/admin/indexnow',{method,headers:{origin:requestOrigin,'content-type':'application/json',...(authenticated?{cookie:sessionCookie}:{})},...(body?{body:JSON.stringify(body)}:{})})});
        };
        assert.equal((await call('GET',null,false)).status,401);
        assert.equal((await call('PUT',{key},true,cookie,'https://foreign.example.com')).status,403);
        await db().insert(s.user).values({id:'viewer',name:'Viewer',email:'viewer@example.test',emailVerified:true});
        await db().insert(s.account).values({id:'viewer-credential',accountId:'viewer',providerId:'credential',userId:'viewer',password:await hashPassword('isolated-installer-password')});
        const viewerLogin=await getAuth().api.signInEmail({body:{email:'viewer@example.test',password:'isolated-installer-password'},headers:new Headers({origin}),asResponse:true});
        const viewerCookie=viewerLogin.headers.getSetCookie().map((v)=>v.split(';')[0]).join('; ');
        for(const method of ['GET','PUT','POST']) assert.equal((await call(method,method==='GET'?null:method==='PUT'?{key}:{urls:[origin+'/page']},true,viewerCookie)).status,403);
        assert.equal(await service.getIndexNowKey(),null);
        const saved = await call('PUT',{key});
        assert.equal(saved.status,200);
        const savedData=(await saved.json()).data;
        assert.equal(savedData.key,key);
        assert.deepEqual(savedData.permissions,{read:true,write:true,submit:true});
        assert.equal(await service.getIndexNowKey(),key);
        const file = await keyRoute.options.server.handlers.GET({params:{key}});
        assert.equal(file.status,200);
        assert.equal(await file.text(),key);
        const nativeFetch = globalThis.fetch;
        let count=0;
        globalThis.fetch = async (url,options) => {
          count++;
          assert.equal(String(url),'https://api.indexnow.org/indexnow');
          const body=JSON.parse(options.body);
          assert.equal(body.host,'installer.example.com');
          assert.equal(body.keyLocation,origin+'/'+key+'.txt');
          assert.deepEqual(body.urlList,[origin+'/page']);
          return new Response('',{status:202});
        };
        try {
          const submitted=await call('POST',{urls:[origin+'/page',origin+'/page#top']});
          assert.equal(submitted.status,200);
          const json=await submitted.json();
          assert.equal(json.data.submitted,1);
          assert.equal(json.data.results[0].ok,true);
          assert.equal(count,1);
        } finally {globalThis.fetch=nativeFetch;}
        const rotated='rotated-installer-key-12345';
        await call('PUT',{key:rotated});
        assert.equal((await keyRoute.options.server.handlers.GET({params:{key}})).status,404);
        assert.equal(await service.getIndexNowKey(),rotated);
      `
      );
      execFileSync(process.execPath, ['--import', 'tsx', 'verify.mjs'], {
        cwd: target,
        env,
        stdio: 'pipe',
      });
    } catch (error) {
      if (error.stdout) process.stderr.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
      throw error;
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
}

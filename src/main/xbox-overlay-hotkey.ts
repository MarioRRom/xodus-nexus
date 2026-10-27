import path from 'node:path';

/** Shared with the standalone toggle wrapper; this never mutates compositor binds. */
export function xboxGuideSocketPath(environment:NodeJS.ProcessEnv=process.env,uid=process.getuid?.()):string{
  if(uid===undefined||!Number.isSafeInteger(uid)||uid<0)throw Error('The Nexus Guide requires a local user session.');
  const directory=environment.XDG_RUNTIME_DIR||`/run/user/${uid}`;
  if(!path.isAbsolute(directory)||directory.includes('\0'))throw Error('Invalid Nexus Guide runtime directory.');
  const result=path.join(directory,'xodus-nexus-guide.sock');
  if(Buffer.byteLength(result)>107)throw Error('The Nexus Guide socket path is too long.');
  return result;
}

export function xboxGuideToggleCommand(script:string,socketPath:string):string{
  if(![script,socketPath].every(value=>path.isAbsolute(value)&&!value.includes('\0')))throw Error('Nexus Guide paths must be absolute.');
  const quote=(value:string)=>`'${value.replaceAll("'",`'"'"'`)}'`;
  return ['/usr/bin/python3',script,socketPath].map(quote).join(' ');
}

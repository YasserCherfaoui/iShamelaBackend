import { Global, Module } from '@nestjs/common';

import { ENV, type Env } from '../config/env';
import { MAIL, mailSenderFor } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: MAIL,
      inject: [ENV],
      useFactory: (env: Env) => mailSenderFor(env),
    },
  ],
  exports: [MAIL],
})
export class MailModule {}

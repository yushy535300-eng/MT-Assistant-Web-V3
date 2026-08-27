import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";

function getAccounts() {
  const accounts: Array<{
    username: string;
    password: string;
  }> = [];

  // 最多先支援 100 組
  for (let i = 1; i <= 100; i++) {
    const username = process.env[`APP_USERNAME_${i}`];
    const password = process.env[`APP_PASSWORD_${i}`];

    if (username && password) {
      accounts.push({
        username: username.trim().toLowerCase(),
        password,
      });
    }
  }

  return accounts;
}

export const appRouter = router({
  trackerAccess: router({
    login: publicProcedure
      .input(
        z.object({
          username: z.string().min(1).max(128),
          password: z.string().min(1).max(256),
        })
      )
      .mutation(({ input }) => {
        const username = input.username.trim().toLowerCase();
        const password = input.password;

        const accounts = getAccounts();

        const matched = accounts.some(
          (account) =>
            account.username === username &&
            account.password === password
        );

        return {
          success: matched,
        } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;

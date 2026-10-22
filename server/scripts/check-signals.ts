import "dotenv/config";
import { prisma } from "../src/lib/prisma";
async function main() {
  const users = await prisma.user.findMany({ select: { username: true, role: true } });
  console.log("users in DB:", JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });

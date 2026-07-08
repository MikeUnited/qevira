import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { prisma } = await import("../lib/prisma");
  const counts = {
    cartItem: await prisma.cartItem.count(),
    teamMember: await prisma.teamMember.count(),
    notification: await prisma.notification.count(),
    buyerWarehouse: await prisma.buyerWarehouse.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

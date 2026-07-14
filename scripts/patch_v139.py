"""Patch v138Features.ts with getDagGraph and mergeEntities procedures."""
with open("server/routers/v138Features.ts", "r") as f:
    lines = f.readlines()

# Find line 285 (0-indexed: 284) which is the "});" closing scheduleDepsRouter
# and line 346 (0-indexed: 345) which is the "});" closing sanctionsEntitiesRouter
# We'll insert getDagGraph before line 285 and mergeEntities before line 346

dag_lines = [
    "\n",
    "  getDagGraph: protectedProcedure\n",
    "    .input(z.object({ scheduleId: z.number().int().optional() }))\n",
    "    .query(async ({ input }) => {\n",
    "      const db = await getDb();\n",
    "      if (!db) return { nodes: [], edges: [] };\n",
    "      const allSchedules = await db.select().from(exportSchedules);\n",
    "      const allDeps = await db.select().from(scheduleDependencies);\n",
    "      const nodes = allSchedules.map(s => ({\n",
    "        id: s.id,\n",
    "        label: s.name,\n",
    "        cadence: s.cadence,\n",
    "        isActive: s.isActive,\n",
    "        lastRunAt: s.lastRunAt,\n",
    "        highlighted: input.scheduleId ? s.id === input.scheduleId : false,\n",
    "      }));\n",
    "      const edges = allDeps.map(d => ({\n",
    "        id: d.id,\n",
    "        source: d.dependsOnScheduleId,\n",
    "        target: d.scheduleId,\n",
    "      }));\n",
    "      return { nodes, edges };\n",
    "    }),\n",
]

merge_lines = [
    "\n",
    "  mergeEntities: adminProcedure\n",
    "    .input(z.object({\n",
    "      primaryId: z.number().int(),\n",
    "      duplicateId: z.number().int(),\n",
    "      mergedFields: z.record(z.string(), z.unknown()),\n",
    "    }))\n",
    "    .mutation(async ({ input }) => {\n",
    "      const db = await getDb();\n",
    "      if (!db) throw new Error('Database unavailable');\n",
    "      if (input.primaryId === input.duplicateId) throw new Error('Cannot merge an entity with itself');\n",
    "      const [primary] = await db.select().from(sanctionsEntities).where(eq(sanctionsEntities.id, input.primaryId)).limit(1);\n",
    "      const [duplicate] = await db.select().from(sanctionsEntities).where(eq(sanctionsEntities.id, input.duplicateId)).limit(1);\n",
    "      if (!primary || !duplicate) throw new Error('One or both entities not found');\n",
    "      const allowedFields = ['entityName', 'country', 'entityType', 'riskScore', 'metadata'];\n",
    "      const updateData: Record<string, unknown> = { updatedAt: new Date() };\n",
    "      for (const field of allowedFields) {\n",
    "        if (field in input.mergedFields) updateData[field] = input.mergedFields[field];\n",
    "      }\n",
    "      await db.update(sanctionsEntities).set(updateData as any).where(eq(sanctionsEntities.id, input.primaryId));\n",
    "      await db.update(sanctionsEntities).set({ isActive: false, updatedAt: new Date() }).where(eq(sanctionsEntities.id, input.duplicateId));\n",
    "      return { success: true, primaryId: input.primaryId, archivedId: input.duplicateId };\n",
    "    }),\n",
]

# Find the two insertion points
dag_insert_line = None
merge_insert_line = None

in_schedule_deps = False
in_sanctions_entities = False

for i, line in enumerate(lines):
    if "Schedule Dependencies" in line:
        in_schedule_deps = True
        in_sanctions_entities = False
    elif "Sanctions Entities" in line:
        in_sanctions_entities = True
        in_schedule_deps = False
    elif "Sanctions Watchlist" in line:
        in_sanctions_entities = False

    if in_schedule_deps and line.strip() == "});":
        dag_insert_line = i
        in_schedule_deps = False
        print(f"Found scheduleDeps closing at line {i+1}")
    if in_sanctions_entities and line.strip() == "});":
        merge_insert_line = i
        in_sanctions_entities = False
        print(f"Found sanctionsEntities closing at line {i+1}")

if dag_insert_line is None or merge_insert_line is None:
    print(f"ERROR: dag_insert_line={dag_insert_line}, merge_insert_line={merge_insert_line}")
    exit(1)

# Insert merge_lines first (higher line number, so insert in reverse order)
lines = lines[:merge_insert_line] + merge_lines + lines[merge_insert_line:]
# Now dag_insert_line is still valid since we inserted after it
lines = lines[:dag_insert_line] + dag_lines + lines[dag_insert_line:]

with open("server/routers/v138Features.ts", "w") as f:
    f.writelines(lines)

print("Patch applied successfully")

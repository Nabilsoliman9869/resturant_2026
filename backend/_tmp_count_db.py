from api_server import get_connection
c=get_connection(); cur=c.cursor()
# groups that look like grills
cur.execute("""
SELECT g.CardGuide, g.GroupName, COUNT(p.CardGuide) AS Cnt
FROM TBL006 g
LEFT JOIN TBL007 p ON p.GroupGuid = g.CardGuide AND ISNULL(p.NotActive,0)=0
WHERE g.GroupName LIKE N'%مشويات%' OR g.GroupName LIKE N'%Grill%'
GROUP BY g.CardGuide, g.GroupName
ORDER BY g.GroupName
""")
rows=cur.fetchall()
print('DB_GROUPS', len(rows))
for r in rows:
    print(str(r[0]), '|', r[1], '| count=', int(r[2] or 0))

# total active products in DB
cur.execute("SELECT COUNT(*) FROM TBL007 WHERE ISNULL(NotActive,0)=0 AND ProductName IS NOT NULL")
print('DB_ACTIVE_PRODUCTS', int(cur.fetchone()[0]))
c.close()

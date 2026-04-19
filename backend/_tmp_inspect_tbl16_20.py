from api_server import get_connection
c=get_connection();cur=c.cursor()
for t in ['TBL016','TBL020']:
    print('===', t, '===')
    sql = "SELECT COLUMN_NAME,DATA_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='{}' ORDER BY ORDINAL_POSITION".format(t)
    cur.execute(sql)
    for r in cur.fetchall():
        print(r[0], r[1], r[2], r[3])
    cur.execute('SELECT TOP 2 * FROM {}'.format(t))
    cols=[d[0] for d in cur.description]
    rows=cur.fetchall()
    print('TOP',len(rows))
    for row in rows:
        m=dict(zip(cols,row))
        keys=[k for k in cols if k in ['CardGuide','CardCode','AgentName','MainGroupGuide','AccountID','InvoiceName','InvoiceMovementSide','Fields','BillType','BillKind','PriceType','POSType','DefaultPayType','AgentAccountSide']]
        print({k:m.get(k) for k in keys})
    print()
c.close()

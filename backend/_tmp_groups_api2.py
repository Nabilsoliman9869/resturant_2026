import requests
base='http://127.0.0.1:2288'
g=requests.get(base+'/api/product-groups',timeout=20).json().get('groups',[])
print('API_GROUPS',len(g))
sel=[x for x in g if ('مشويات' in str(x.get('GroupName') or '')) or ('grill' in str(x.get('GroupName') or '').lower())]
print('API_GRILL_GROUPS',len(sel))
for x in sel:
    gid=str(x.get('CardGuide') or '')
    p=requests.get(base+f'/api/products?group_guide={gid}',timeout=20).json().get('products',[])
    print(x.get('GroupName'),'count',len(p))

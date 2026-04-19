import requests
base='http://127.0.0.1:2288'
g=requests.get(base+'/api/product-groups',timeout=20).json().get('product_groups',[])
print('API_GROUPS',len(g))
sel=[x for x in g if ('مشويات' in str(x.get('GroupName') or '')) or ('grill' in str(x.get('GroupName') or '').lower())]
print('API_GRILL_GROUPS',len(sel))
for x in sel:
    gid=str(x.get('CardGuide') or '')
    nm=x.get('GroupName')
    p=requests.get(base+f'/api/products?group_guide={gid}',timeout=20).json().get('products',[])
    print(gid,'|',nm,'| api_products=',len(p))
allp=requests.get(base+'/api/products',timeout=20).json().get('products',[])
print('API_ALL_PRODUCTS',len(allp))

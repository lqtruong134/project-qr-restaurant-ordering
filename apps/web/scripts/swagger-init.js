/* global SwaggerUIBundle */
SwaggerUIBundle({
 url:'/api-docs-assets/openapi.json',dom_id:'#swagger-ui',deepLinking:true,
 validatorUrl:null,queryConfigEnabled:false,persistAuthorization:false,
 withCredentials:true,displayRequestDuration:true,defaultModelsExpandDepth:-1,
 supportedSubmitMethods:['get','post','put','patch','delete'],
 requestInterceptor(request){
  const url=new URL(request.url,window.location.origin);
  if(url.origin!==window.location.origin)throw new Error('Chỉ cho phép API cùng nguồn với ứng dụng.');
  request.credentials='same-origin';
  if(!['GET','HEAD','OPTIONS'].includes((request.method||'GET').toUpperCase()))request.headers['X-CSRF-Protection']='1';
  return request;
 }
});

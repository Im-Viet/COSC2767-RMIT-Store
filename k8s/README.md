# Kubernetes manifests for RMIT Store (Dev & Prod)

These YAMLs assume:
- External MongoDB on a single EC2 (shared by dev and prod)
- Frontend runs **webpack-dev-server** on port **8080**
- Backend runs **nodemon** on port **3000**
- Images are pushed to ECR as:
  - `YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rmit-store/frontend:IMAGE_TAG`
  - `YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rmit-store/backend:IMAGE_TAG`

> Replace placeholders: `YOUR_ACCOUNT_ID`, `IMAGE_TAG`, `DB_PRIVATE_IP`, secrets.

## Apply (Dev)
```bash
kubectl apply -f k8s/dev/
# Patch images after pushing to ECR:
kubectl -n dev set image deploy/backend backend=YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rmit-store/backend:IMAGE_TAG
kubectl -n dev set image deploy/frontend frontend=YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rmit-store/frontend:IMAGE_TAG
```

## Apply (Prod initial - active color=blue)
```bash
kubectl apply -f k8s/prod/
# Patch blue images on first deploy:
kubectl -n prod set image deploy/backend-blue backend=YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rmit-store/backend:IMAGE_TAG
kubectl -n prod set image deploy/frontend-blue frontend=YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/rmit-store/frontend:IMAGE_TAG
# Switch color later by editing Service selector (see prod services).
```

## Ingress
These use the `ingress-nginx` class. After install, get EXTERNAL-IP via:
```bash
kubectl get svc -n ingress-nginx
```

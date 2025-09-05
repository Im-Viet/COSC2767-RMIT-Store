pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(name: 'AWS_REGION',    defaultValue: 'us-east-1', description: 'AWS region')
    string(name: 'EKS_CLUSTER',   defaultValue: 'rmit-eks',  description: 'EKS cluster name')
    string(name: 'K8S_NAMESPACE', defaultValue: 'dev',       description: 'Kubernetes namespace')
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: false, description: 'Apply k8s/<namespace>/ manifests (first deploy)')
    booleanParam(name: 'SEED_DB',        defaultValue: false, description: 'Run seed job after deploy')
    string(name: 'BACKEND_REPO', defaultValue: 'rmit-store/backend', description: 'Backend repository')
    string(name: 'FRONTEND_REPO', defaultValue: 'rmit-store/frontend', description: 'Frontend repository')
    // Use Jenkins Credentials instead of plain strings:
    // Create a Jenkins credential ID "seed-admin" (Username = admin email, Password = admin password)
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    NAMESPACE = "${params.K8S_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
    DOCKER_BUILDKIT = "1"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git --no-pager log -1 --pretty=oneline || true'
      }
    }

    stage('Resolve IDs & Login to ECR') {
      steps {
        script {
          env.ACCOUNT_ID = sh(script: "aws sts get-caller-identity --query Account --output text", returnStdout: true).trim()
          env.ECR = "${env.ACCOUNT_ID}.dkr.ecr.${env.REGION}.amazonaws.com"
          env.GIT_SHA = sh(script: "git rev-parse --short=12 HEAD", returnStdout: true).trim()
          env.IMG_TAG = "${env.GIT_SHA}-${env.BUILD_NUMBER}"
          env.BACKEND_IMAGE = "${env.ECR}/rmit-store/backend:${env.IMG_TAG}"
          env.FRONTEND_IMAGE = "${env.ECR}/rmit-store/frontend:${env.IMG_TAG}"
        }
        sh '''
          aws ecr get-login-password --region "$REGION" | \
            docker login --username AWS --password-stdin "$ECR"
        '''
      }
    }

    stage('Ensure ECR repositories') {
      steps {
        sh '''
          set -euo pipefail

          ensure_repo () {
            local repo="$1"
            if aws ecr describe-repositories --region "$REGION" --repository-names "$repo" >/dev/null 2>&1; then
              echo "ECR repo $repo already exists"
            else
              echo "Creating ECR repo: $repo"
              aws ecr create-repository \
                --region "$REGION" \
                --repository-name "$repo" \
                --image-scanning-configuration scanOnPush=true \
                --encryption-configuration encryptionType=AES256

              # Optional: keep only the last 6 images (best-effort; ignore if denied)
              aws ecr put-lifecycle-policy \
                --region "$REGION" \
                --repository-name "$repo" \
                --lifecycle-policy-text '{
                  "rules": [
                    {
                      "rulePriority": 1,
                      "description": "Keep last 6 images",
                      "selection": { "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 6 },
                      "action": { "type": "expire" }
                    }
                  ]
                }' || true
            fi
          }

          ensure_repo "$BACKEND_REPO"
          ensure_repo "$FRONTEND_REPO"
        '''
      }
    }

    stage('Build backend image') {
      steps {
        sh '''
          docker build \
            --file server/Dockerfile \
            --tag "$BACKEND_IMAGE" \
            .
        '''
      }
    }

    stage('Build frontend image') {
      steps {
        sh '''
          docker build \
            --file client/Dockerfile \
            --tag "$FRONTEND_IMAGE" \
            .
        '''
      }
    }

    stage('Push images') {
      steps {
        sh '''
          docker push "$BACKEND_IMAGE"
          docker push "$FRONTEND_IMAGE"
        '''
      }
    }

    stage('Kube context') {
      steps {
        sh 'aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"'
        sh 'kubectl version --short || true'
      }
    }

    stage('Apply k8s manifests (first time only)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps {
        sh '''
          # apply everything under k8s/<namespace> (your repo already has k8s/dev)
          if [ -d "k8s/$NAMESPACE" ]; then
            kubectl -n "$NAMESPACE" apply -f "k8s/$NAMESPACE"
          else
            echo "WARN: k8s/$NAMESPACE not found; skipping"
          fi
        '''
      }
    }

    stage('Deploy new images') {
      steps {
        sh '''
          # update Deployments to the freshly pushed images
          kubectl -n "$NAMESPACE" set image deploy/backend backend="$BACKEND_IMAGE"
          kubectl -n "$NAMESPACE" set image deploy/frontend frontend="$FRONTEND_IMAGE"

          # wait for rollouts (does NOT require kubectl exec/logs)
          kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/frontend --timeout=180s
        '''
      }
    }

    stage('Seed database (optional, no exec)') {
      when { expression { return params.SEED_DB } }
      steps {
        // Use Jenkins credentials 'seed-admin' to avoid hardcoding secrets
        withCredentials([usernamePassword(credentialsId: 'seed-admin', usernameVariable: 'SEED_ADMIN_EMAIL', passwordVariable: 'SEED_ADMIN_PASSWORD')]) {
          sh '''
cat <<'YAML' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: seed-db-${BUILD_NUMBER}
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: seed
        image: ${BACKEND_IMAGE}
        command: ["sh","-lc"]
        args: ["npm run seed:db -- ${SEED_ADMIN_EMAIL} ${SEED_ADMIN_PASSWORD}"]
        env:
        - name: PORT
          value: "3000"
        - name: BASE_API_URL
          value: "api"
        - name: MONGO_URI
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: MONGO_URI
YAML
kubectl -n "$NAMESPACE" wait --for=condition=complete job/seed-db-${BUILD_NUMBER} --timeout=180s || true
kubectl -n "$NAMESPACE" delete job/seed-db-${BUILD_NUMBER} --ignore-not-found=true
          '''
        }
      }
    }

    stage('Show endpoints') {
      steps {
        sh '''
          echo "=== Kubernetes objects ($NAMESPACE) ==="
          kubectl -n "$NAMESPACE" get deploy,svc,ingress -o wide || true

          echo "=== If using NGINX Ingress Service LB ==="
          kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{"\\n"}' || true

          echo "You can test:   curl http://<ELB>/api/brand/list"
        '''
      }
    }
  }

  post {
    failure {
      echo "Deployment failed – attempting rollback"
      sh '''
        kubectl -n "$NAMESPACE" rollout undo deploy/backend || true
        kubectl -n "$NAMESPACE" rollout undo deploy/frontend || true
        kubectl -n "$NAMESPACE" get deploy -o wide || true
      '''
    }
    always {
      archiveArtifacts artifacts: '**/Dockerfile, k8s/**/*.yaml', fingerprint: true, onlyIfSuccessful: false
    }
    success {
      echo "✅ Deployed images:"
      echo "   $BACKEND_IMAGE"
      echo "   $FRONTEND_IMAGE"
    }
  }
}

# Deploy on AWS ECS Fargate

More control than App Runner. Use when you need sidecars, multi-port tasks, exec access, or are already on ECS.

## When to use

- Need `ecs exec` for debugging running containers
- Need sidecars (Datadog agent, envoy proxy)
- Running Ory Kratos + Hydra as multi-port tasks
- Already have ECS infrastructure
- Need ECS Savings Plans for cost optimization

## Prerequisites

- AWS account with CDK bootstrapped
- VPC with public + private subnets
- ECR repository for your app image

## Architecture

```
ALB (HTTPS, port 443)
  └── Target Group (port 3000)
       └── ECS Service (Fargate)
            └── Task (your app container)
                 └── fz-auth BFF routes
```

## Steps

### 1. Dockerfile

Same as App Runner (see `aws-apprunner.md`). Add `USER node` for non-root.

### 2. CDK Stack

```ts
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'

export class AppStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string) {
    super(scope, id)

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 })
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc })

    const repo = ecr.Repository.fromRepositoryName(this, 'Repo', 'my-app')
    const sessionSecret = new secretsmanager.Secret(this, 'SessionSecret', {
      generateSecretString: { excludeCharacters: ',', passwordLength: 64 },
    })

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 256,
      memoryLimitMiB: 512,
    })

    taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        ISSUER_URL: 'https://your-idp.com',
        CLIENT_ID: 'your-client-id',
      },
      secrets: {
        SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app' }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/auth/session || exit 0'],
        interval: cdk.Duration.seconds(30),
        retries: 3,
      },
    })

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      enableExecuteCommand: true,  // Allows `ecs exec` for debugging
    })

    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
    })

    const listener = alb.addListener('Listener', {
      port: 443,
      certificates: [/* your ACM certificate */],
    })

    listener.addTargets('App', {
      port: 3000,
      targets: [service],
      healthCheck: { path: '/auth/session', healthyHttpCodes: '200-401' },
    })
  }
}
```

### 3. Deploy

```bash
npx cdk deploy
```

### 4. Debug with exec

```bash
aws ecs execute-command \
  --cluster my-cluster \
  --task $TASK_ID \
  --container app \
  --interactive \
  --command "/bin/sh"
```

This is the main advantage over App Runner — you can shell into running containers.

### 5. Deploy workflow

```yaml
# .github/workflows/deploy.yml
- name: Deploy to ECS
  run: |
    aws ecs update-service \
      --cluster my-cluster \
      --service my-service \
      --force-new-deployment
```

ECS handles rolling deployments automatically — new tasks start, old tasks drain.

## Cost

| Component | Monthly |
|-----------|---------|
| Fargate (2 tasks, 0.25 vCPU, 0.5 GB) | ~$18 |
| ALB | ~$16 |
| ECR | ~$1 |
| Secrets Manager | ~$0.50 |
| **Total** | **~$36** |

More expensive than App Runner (~$7-17) due to the ALB. The tradeoff is full control.

## Comparison with App Runner

| Feature | App Runner | ECS Fargate |
|---------|-----------|-------------|
| Setup effort | Low | Medium |
| Cost (low traffic) | ~$7-17/mo | ~$36/mo |
| Exec into container | No | Yes |
| Sidecars | No | Yes |
| Multi-port tasks | No | Yes |
| Scale to zero | Yes | No (min 1 task) |
| Custom health checks | HTTP GET only | Any command |
| ALB required | No (built-in) | Yes |

## Running Ory on ECS

If you're self-hosting Ory, ECS lets you run Kratos (port 4433 + 4434) and Hydra (port 4444 + 4445) as multi-port tasks — no need to split into separate services like App Runner requires:

```ts
taskDef.addContainer('kratos', {
  image: ecs.ContainerImage.fromEcrRepository(kratosRepo),
  portMappings: [
    { containerPort: 4433, name: 'kratos-public' },
    { containerPort: 4434, name: 'kratos-admin' },
  ],
})
```
